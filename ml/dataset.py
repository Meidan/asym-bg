import hashlib
import json
import os
from dataclasses import dataclass
from typing import List, Optional, Dict, Any, Tuple, Iterable

import numpy as np
import pandas as pd
import pyarrow.parquet as pq
import torch
from torch.utils.data import Dataset, IterableDataset

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


def _resolve_parquet_paths(path: str) -> List[str]:
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
  return paths


class AsymParquetDataset(Dataset):
  def __init__(self, path: str):
    paths = _resolve_parquet_paths(path)

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


class AsymParquetIterableDataset(IterableDataset):
  def __init__(
    self,
    path: str,
    split: str = 'train',
    val_ratio: float = 0.1,
    seed: int = 42,
    batch_rows: int = 4096
  ):
    self.paths = _resolve_parquet_paths(path)
    if split not in ('train', 'val', 'all'):
      raise ValueError("split must be 'train', 'val', or 'all'")
    self.split = split
    self.val_ratio = float(val_ratio)
    self.seed = int(seed)
    self.batch_rows = int(batch_rows)

  def _is_val(self, match_index: int) -> bool:
    if self.val_ratio <= 0:
      return False
    if self.val_ratio >= 1:
      return True
    key = f"{self.seed}:{match_index}".encode('utf-8')
    digest = hashlib.md5(key).digest()
    value = int.from_bytes(digest[:8], 'big')
    return (value / 2**64) < self.val_ratio

  def _include(self, match_index: int) -> bool:
    if self.split == 'all':
      return True
    is_val = self._is_val(match_index)
    return is_val if self.split == 'val' else not is_val

  def _iter_samples(self, rows: Dict[str, List[Any]]) -> Iterable[Sample]:
    states = rows.get('state', [])
    action_types = rows.get('action_type', [])
    legal_moves_col = rows.get('legal_moves', [])
    chosen_index_col = rows.get('chosen_index', [])
    decision_col = rows.get('decision', [])
    roles = rows.get('role', [])
    match_indices = rows.get('match_index', [])
    game_indices = rows.get('game_index', [])
    ply_indices = rows.get('ply_index', [])
    game_results = rows.get('game_result', [])
    match_results = rows.get('match_result', [])
    game_points = rows.get('game_points', [])
    match_points = rows.get('match_points', [])

    for i in range(len(states)):
      match_index = int(match_indices[i])
      if not self._include(match_index):
        continue
      state = np.asarray(states[i], dtype=np.float32)
      action_type = str(action_types[i])
      raw_legal = legal_moves_col[i] if i < len(legal_moves_col) else None
      legal_moves = None
      if raw_legal is not None:
        if isinstance(raw_legal, (bytes, bytearray)):
          raw_legal = raw_legal.decode('utf-8')
        if isinstance(raw_legal, str):
          legal_moves = json.loads(raw_legal)
        elif isinstance(raw_legal, (list, tuple)):
          legal_moves = [str(item) for item in raw_legal]
      chosen_index = None
      if i < len(chosen_index_col) and chosen_index_col[i] is not None:
        chosen_index = int(chosen_index_col[i])
      decision = None
      if i < len(decision_col) and decision_col[i] is not None:
        decision = bool(decision_col[i])
      game_result = _maybe_float(game_results[i]) if i < len(game_results) else None
      match_result = _maybe_float(match_results[i]) if i < len(match_results) else None
      game_point = _maybe_float(game_points[i]) if i < len(game_points) else None
      match_point = _maybe_float(match_points[i]) if i < len(match_points) else None

      yield Sample(
        state=state,
        action_type=action_type,
        legal_moves=legal_moves,
        chosen_index=chosen_index,
        decision=decision,
        role=str(roles[i]) if i < len(roles) else '',
        match_index=match_index,
        game_index=int(game_indices[i]) if i < len(game_indices) else 0,
        ply_index=int(ply_indices[i]) if i < len(ply_indices) else 0,
        game_result=game_result,
        match_result=match_result,
        game_points=game_point,
        match_points=match_point
      )

  def __iter__(self) -> Iterable[Sample]:
    columns = [
      'state',
      'action_type',
      'legal_moves',
      'chosen_index',
      'decision',
      'role',
      'match_index',
      'game_index',
      'ply_index',
      'game_result',
      'match_result',
      'game_points',
      'match_points'
    ]
    for path in self.paths:
      parquet_file = pq.ParquetFile(path)
      available = set(parquet_file.schema.names)
      file_columns = [name for name in columns if name in available]
      for batch in parquet_file.iter_batches(batch_size=self.batch_rows, columns=file_columns):
        rows = batch.to_pydict()
        for sample in self._iter_samples(rows):
          yield sample


def split_by_match(df: pd.DataFrame, val_ratio: float, seed: int) -> Tuple[List[int], List[int]]:
  matches = df['match_index'].unique()
  rng = np.random.default_rng(seed)
  rng.shuffle(matches)
  val_count = max(1, int(len(matches) * val_ratio)) if len(matches) > 1 else 0
  val_matches = set(matches[:val_count])
  train_idx = df.index[~df['match_index'].isin(val_matches)].tolist()
  val_idx = df.index[df['match_index'].isin(val_matches)].tolist()
  return train_idx, val_idx


def _get_value_target(sample: Sample, value_target: str) -> Optional[float]:
  if value_target == 'game_result':
    return sample.game_result
  if value_target == 'match_result':
    return sample.match_result
  if value_target == 'game_points':
    return sample.game_points
  if value_target == 'match_points':
    return sample.match_points
  raise ValueError(f'Unsupported value_target: {value_target}')


def collate_batch(batch: List[Sample], value_target: Optional[str] = None) -> Dict[str, Any]:
  move_items = []
  double_items = []
  value_items = []

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
    if (
      sample.game_result is not None or
      sample.match_result is not None or
      sample.game_points is not None or
      sample.match_points is not None
    ):
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
    if value_target:
      filtered_states = []
      filtered_targets = []
      for sample in value_items:
        target = _get_value_target(sample, value_target)
        if target is None:
          continue
        filtered_states.append(sample.state)
        filtered_targets.append(target)
      if filtered_states:
        state_array = np.stack(filtered_states).astype(np.float32, copy=False)
        target_array = np.array(filtered_targets, dtype=np.float32)
        batch_out['value'] = {
          'state': torch.from_numpy(state_array),
          'target': torch.from_numpy(target_array)
        }
    else:
      state_array = np.stack([sample.state for sample in value_items]).astype(np.float32, copy=False)
      game_array = np.array([sample.game_result for sample in value_items], dtype=np.float32)
      match_array = np.array([sample.match_result for sample in value_items], dtype=np.float32)
      game_points_array = np.array([sample.game_points for sample in value_items], dtype=np.float32)
      match_points_array = np.array([sample.match_points for sample in value_items], dtype=np.float32)
      batch_out['value'] = {
        'state': torch.from_numpy(state_array),
        'game_target': torch.from_numpy(game_array),
        'match_target': torch.from_numpy(match_array),
        'game_points': torch.from_numpy(game_points_array),
        'match_points': torch.from_numpy(match_points_array)
      }

  return batch_out
