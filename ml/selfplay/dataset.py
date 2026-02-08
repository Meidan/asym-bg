import json
import os
from dataclasses import dataclass
from typing import List, Optional, Dict, Any, Tuple

import numpy as np
import pandas as pd
import pyarrow.parquet as pq
import torch
from torch.utils.data import Dataset

MOVE_MAX = 4
MOVE_FEATURE_DIM = MOVE_MAX * 3 + 1


def _norm_point(value: int) -> float:
  if value < 0:
    return 0.0
  return float(value) / 25.0


def encode_move_sequence(seq: str) -> np.ndarray:
  parts = seq.split('|') if seq else []
  feats: List[float] = []
  for part in parts[:MOVE_MAX]:
    raw_from, raw_to, raw_die = part.split(':')
    from_pt = int(raw_from)
    to_pt = int(raw_to)
    die_val = int(raw_die)
    feats.extend([_norm_point(from_pt), _norm_point(to_pt), float(die_val) / 6.0])
  while len(feats) < MOVE_MAX * 3:
    feats.extend([0.0, 0.0, 0.0])
  feats.append(len(parts) / MOVE_MAX)
  return np.array(feats, dtype=np.float32)


@dataclass
class Sample:
  state: np.ndarray
  action_type: str
  legal_moves: Optional[List[str]]
  chosen_index: Optional[int]
  decision: Optional[bool]
  role: str
  match_index: int
  game_index: int
  ply_index: int
  game_result: Optional[float]
  match_result: Optional[float]
  game_points: Optional[float]
  match_points: Optional[float]


def _maybe_float(value: Any) -> Optional[float]:
  if value is None:
    return None
  if isinstance(value, (int, float, np.floating)):
    return float(value)
  if isinstance(value, str) and value.strip():
    try:
      return float(value)
    except ValueError:
      return None
  if pd.isna(value):
    return None
  return None


class SelfplayParquetDataset(Dataset):
  def __init__(self, path: str):
    paths = [item.strip() for item in str(path).split(',') if item.strip()]
    if len(paths) == 1 and os.path.isdir(paths[0]):
      directory = paths[0]
      files = sorted(
        file for file in (os.path.join(directory, name) for name in os.listdir(directory))
        if file.endswith('.parquet')
      )
      if not files:
        raise ValueError(f'No parquet files found in directory: {directory}')
      paths = files

    table = pq.read_table(paths)
    self.df = table.to_pandas()

  def __len__(self) -> int:
    return len(self.df)

  def __getitem__(self, idx: int) -> Sample:
    row = self.df.iloc[idx]
    state = np.array(row['state'], dtype=np.float32)
    action_type = str(row['action_type'])
    legal_moves = None
    if isinstance(row.get('legal_moves'), str):
      legal_moves = json.loads(row['legal_moves'])
    chosen_index = None
    if pd.notna(row.get('chosen_index')):
      chosen_index = int(row['chosen_index'])
    decision = None
    if pd.notna(row.get('decision')):
      decision = bool(row['decision'])
    role = str(row['role'])
    match_index = int(row['match_index'])
    game_index = int(row['game_index'])
    ply_index = int(row['ply_index'])

    game_result = _maybe_float(row.get('game_result'))
    match_result = _maybe_float(row.get('match_result'))
    game_points = _maybe_float(row.get('game_points'))
    match_points = _maybe_float(row.get('match_points'))

    return Sample(
      state=state,
      action_type=action_type,
      legal_moves=legal_moves,
      chosen_index=chosen_index,
      decision=decision,
      role=role,
      match_index=match_index,
      game_index=game_index,
      ply_index=ply_index,
      game_result=game_result,
      match_result=match_result,
      game_points=game_points,
      match_points=match_points
    )


def split_by_match(df: pd.DataFrame, val_ratio: float, seed: int) -> Tuple[List[int], List[int]]:
  matches = df['match_index'].unique()
  rng = np.random.default_rng(seed)
  rng.shuffle(matches)
  val_count = max(1, int(len(matches) * val_ratio)) if len(matches) > 1 else 0
  val_matches = set(matches[:val_count])
  train_idx = df.index[~df['match_index'].isin(val_matches)].tolist()
  val_idx = df.index[df['match_index'].isin(val_matches)].tolist()
  return train_idx, val_idx


def collate_batch(batch: List[Sample]) -> Dict[str, Any]:
  move_items: List[Sample] = []
  double_items: List[Sample] = []
  value_items: List[Sample] = []

  for sample in batch:
    if sample.action_type == 'move':
      if not sample.legal_moves:
        continue
      if sample.chosen_index is None or sample.chosen_index < 0:
        continue
      if sample.chosen_index >= len(sample.legal_moves):
        continue
      move_items.append(sample)
    elif sample.action_type in ('double_offer', 'double_accept'):
      if sample.decision is None:
        continue
      double_items.append(sample)

    if sample.game_result is not None and sample.match_result is not None:
      value_items.append(sample)

  batch_out: Dict[str, Any] = {}

  if move_items:
    max_moves = max(len(sample.legal_moves) for sample in move_items)
    state_array = np.stack([sample.state for sample in move_items]).astype(np.float32, copy=False)
    move_array = np.zeros((len(move_items), max_moves, MOVE_FEATURE_DIM), dtype=np.float32)
    mask_array = np.zeros((len(move_items), max_moves), dtype=np.bool_)
    chosen_array = np.array([sample.chosen_index for sample in move_items], dtype=np.int64)

    for i, sample in enumerate(move_items):
      for j, seq in enumerate(sample.legal_moves):
        move_array[i, j] = encode_move_sequence(seq)
        mask_array[i, j] = True

    batch_out['move'] = {
      'state': torch.from_numpy(state_array),
      'moves': torch.from_numpy(move_array),
      'mask': torch.from_numpy(mask_array),
      'chosen': torch.from_numpy(chosen_array)
    }

  if double_items:
    state_array = np.stack([sample.state for sample in double_items]).astype(np.float32, copy=False)
    decision_array = np.array(
      [1.0 if sample.decision else 0.0 for sample in double_items],
      dtype=np.float32
    )
    batch_out['double'] = {
      'state': torch.from_numpy(state_array),
      'decision': torch.from_numpy(decision_array)
    }

  if value_items:
    state_array = np.stack([sample.state for sample in value_items]).astype(np.float32, copy=False)
    game_array = np.array([sample.game_result for sample in value_items], dtype=np.float32)
    match_array = np.array([sample.match_result for sample in value_items], dtype=np.float32)
    batch_out['value'] = {
      'state': torch.from_numpy(state_array),
      'game_target': torch.from_numpy(game_array),
      'match_target': torch.from_numpy(match_array)
    }

  return batch_out
