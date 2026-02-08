import argparse
import json
import os
from typing import Dict, Any

import numpy as np
import torch
import torch.nn.functional as F
from torch.utils.data import DataLoader, Subset

from dataset import SelfplayParquetDataset, collate_batch, split_by_match, MOVE_FEATURE_DIM
from model import AsymPolicyValueModel


def load_config(path: str) -> Dict[str, Any]:
  with open(path, 'r', encoding='utf-8') as f:
    return json.load(f)


def get_device(config: Dict[str, Any]) -> torch.device:
  requested = config.get('device', 'auto')
  if requested == 'auto':
    return torch.device('cuda' if torch.cuda.is_available() else 'cpu')
  return torch.device(requested)


def train_epoch(model, loader, optimizer, device, weights):
  model.train()
  move_loss_total = 0.0
  double_loss_total = 0.0
  value_game_loss_total = 0.0
  value_match_loss_total = 0.0
  move_batches = 0
  double_batches = 0
  value_batches = 0

  for batch in loader:
    optimizer.zero_grad(set_to_none=True)
    loss = 0.0

    if 'move' in batch:
      move_batch = batch['move']
      state = move_batch['state'].to(device)
      moves = move_batch['moves'].to(device)
      mask = move_batch['mask'].to(device)
      chosen = move_batch['chosen'].to(device)

      scores = model.score_moves(state, moves)
      scores = scores.masked_fill(~mask, -1e9)
      loss_move = F.cross_entropy(scores, chosen)
      loss = loss + loss_move
      move_loss_total += loss_move.item()
      move_batches += 1

    if 'double' in batch:
      double_batch = batch['double']
      state = double_batch['state'].to(device)
      decision = double_batch['decision'].to(device)
      logits = model.double_logits(state)
      loss_double = F.binary_cross_entropy_with_logits(logits, decision)
      loss = loss + weights['double'] * loss_double
      double_loss_total += loss_double.item()
      double_batches += 1

    if 'value' in batch:
      value_batch = batch['value']
      state = value_batch['state'].to(device)
      target_game = value_batch['game_target'].to(device)
      target_match = value_batch['match_target'].to(device)
      pred_game, pred_match = model.value_logits(state)
      loss_game = F.mse_loss(pred_game, target_game)
      loss_match = F.mse_loss(pred_match, target_match)
      loss = loss + weights['value_game'] * loss_game + weights['value_match'] * loss_match
      value_game_loss_total += loss_game.item()
      value_match_loss_total += loss_match.item()
      value_batches += 1

    if loss == 0.0:
      continue
    loss.backward()
    optimizer.step()

  return {
    'move_loss': move_loss_total / max(1, move_batches),
    'double_loss': double_loss_total / max(1, double_batches),
    'value_game_loss': value_game_loss_total / max(1, value_batches),
    'value_match_loss': value_match_loss_total / max(1, value_batches)
  }


def eval_epoch(model, loader, device, weights):
  model.eval()
  move_loss_total = 0.0
  double_loss_total = 0.0
  value_game_loss_total = 0.0
  value_match_loss_total = 0.0
  move_batches = 0
  double_batches = 0
  value_batches = 0

  with torch.no_grad():
    for batch in loader:
      if 'move' in batch:
        move_batch = batch['move']
        state = move_batch['state'].to(device)
        moves = move_batch['moves'].to(device)
        mask = move_batch['mask'].to(device)
        chosen = move_batch['chosen'].to(device)

        scores = model.score_moves(state, moves)
        scores = scores.masked_fill(~mask, -1e9)
        loss_move = F.cross_entropy(scores, chosen)
        move_loss_total += loss_move.item()
        move_batches += 1

      if 'double' in batch:
        double_batch = batch['double']
        state = double_batch['state'].to(device)
        decision = double_batch['decision'].to(device)
        logits = model.double_logits(state)
        loss_double = F.binary_cross_entropy_with_logits(logits, decision)
        double_loss_total += loss_double.item()
        double_batches += 1

      if 'value' in batch:
        value_batch = batch['value']
        state = value_batch['state'].to(device)
        target_game = value_batch['game_target'].to(device)
        target_match = value_batch['match_target'].to(device)
        pred_game, pred_match = model.value_logits(state)
        loss_game = F.mse_loss(pred_game, target_game)
        loss_match = F.mse_loss(pred_match, target_match)
        value_game_loss_total += loss_game.item()
        value_match_loss_total += loss_match.item()
        value_batches += 1

  return {
    'move_loss': move_loss_total / max(1, move_batches),
    'double_loss': double_loss_total / max(1, double_batches),
    'value_game_loss': value_game_loss_total / max(1, value_batches),
    'value_match_loss': value_match_loss_total / max(1, value_batches)
  }


def main():
  parser = argparse.ArgumentParser()
  parser.add_argument('--config', default='ml/selfplay/config.json')
  args = parser.parse_args()

  config = load_config(args.config)
  torch.manual_seed(config.get('seed', 42))
  np.random.seed(config.get('seed', 42))

  dataset = SelfplayParquetDataset(config['data_path'])
  train_idx, val_idx = split_by_match(dataset.df, config.get('eval_split', 0.1), config.get('seed', 42))
  train_loader = DataLoader(
    Subset(dataset, train_idx),
    batch_size=config.get('batch_size', 128),
    shuffle=True,
    collate_fn=collate_batch
  )
  val_loader = DataLoader(
    Subset(dataset, val_idx),
    batch_size=config.get('batch_size', 128),
    shuffle=False,
    collate_fn=collate_batch
  )

  device = get_device(config)
  model = AsymPolicyValueModel(
    state_dim=len(dataset[0].state),
    move_dim=MOVE_FEATURE_DIM,
    hidden_size=config.get('hidden_size', 128)
  )
  model.to(device)
  optimizer = torch.optim.Adam(model.parameters(), lr=config.get('learning_rate', 1e-3))

  weights = {
    'double': config.get('double_loss_weight', 0.5),
    'value_game': config.get('value_game_weight', 0.5),
    'value_match': config.get('value_match_weight', 0.5)
  }

  best_loss = float('inf')
  save_path = config['save_path']
  os.makedirs(os.path.dirname(save_path), exist_ok=True)

  for epoch in range(config.get('epochs', 5)):
    train_metrics = train_epoch(model, train_loader, optimizer, device, weights)
    eval_metrics = eval_epoch(model, val_loader, device, weights)
    loss_value = (
      eval_metrics['move_loss'] +
      weights['double'] * eval_metrics['double_loss'] +
      weights['value_game'] * eval_metrics['value_game_loss'] +
      weights['value_match'] * eval_metrics['value_match_loss']
    )

    print(
      f"Epoch {epoch + 1}: "
      f"train_move_loss={train_metrics['move_loss']:.4f} "
      f"train_double_loss={train_metrics['double_loss']:.4f} "
      f"train_value_game_loss={train_metrics['value_game_loss']:.4f} "
      f"train_value_match_loss={train_metrics['value_match_loss']:.4f} "
      f"val_move_loss={eval_metrics['move_loss']:.4f} "
      f"val_double_loss={eval_metrics['double_loss']:.4f} "
      f"val_value_game_loss={eval_metrics['value_game_loss']:.4f} "
      f"val_value_match_loss={eval_metrics['value_match_loss']:.4f}"
    )

    if loss_value < best_loss:
      best_loss = loss_value
      torch.save({
        'model_state': model.state_dict(),
        'config': config
      }, save_path)

  print(f"Saved best model to {save_path}")


if __name__ == '__main__':
  main()
