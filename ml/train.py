import argparse
import json
import os
from typing import Dict, Any

import numpy as np
import torch
from torch.utils.data import DataLoader, Subset
import torch.nn.functional as F

from dataset import AsymParquetDataset, collate_batch, split_by_match, MOVE_FEATURE_DIM
from model import AsymPolicyModel


def load_config(path: str) -> Dict[str, Any]:
  with open(path, 'r', encoding='utf-8') as f:
    return json.load(f)


def get_device(config: Dict[str, Any]) -> torch.device:
  requested = config.get('device', 'auto')
  if requested == 'auto':
    return torch.device('cuda' if torch.cuda.is_available() else 'cpu')
  return torch.device(requested)


def train_epoch(model, loader, optimizer, device, double_weight):
  model.train()
  move_loss_total = 0.0
  double_loss_total = 0.0
  move_batches = 0
  double_batches = 0

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
      loss = loss + double_weight * loss_double
      double_loss_total += loss_double.item()
      double_batches += 1

    if loss == 0.0:
      continue
    loss.backward()
    optimizer.step()

  return {
    'move_loss': move_loss_total / max(1, move_batches),
    'double_loss': double_loss_total / max(1, double_batches)
  }


def eval_epoch(model, loader, device, double_weight):
  model.eval()
  move_loss_total = 0.0
  double_loss_total = 0.0
  move_batches = 0
  double_batches = 0
  move_correct = 0
  move_total = 0
  double_correct = 0
  double_total = 0

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

        preds = scores.argmax(dim=1)
        move_correct += (preds == chosen).sum().item()
        move_total += chosen.size(0)

      if 'double' in batch:
        double_batch = batch['double']
        state = double_batch['state'].to(device)
        decision = double_batch['decision'].to(device)
        logits = model.double_logits(state)
        loss_double = F.binary_cross_entropy_with_logits(logits, decision)
        double_loss_total += loss_double.item()
        double_batches += 1

        preds = (torch.sigmoid(logits) >= 0.5).float()
        double_correct += (preds == decision).sum().item()
        double_total += decision.size(0)

  return {
    'move_loss': move_loss_total / max(1, move_batches),
    'double_loss': double_loss_total / max(1, double_batches),
    'move_acc': move_correct / max(1, move_total),
    'double_acc': double_correct / max(1, double_total)
  }


def main():
  parser = argparse.ArgumentParser()
  parser.add_argument('--config', default='ml/config.json')
  args = parser.parse_args()

  config = load_config(args.config)
  torch.manual_seed(config.get('seed', 42))
  np.random.seed(config.get('seed', 42))

  dataset = AsymParquetDataset(config['data_path'])
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
  model = AsymPolicyModel(state_dim=len(dataset[0].state), move_dim=MOVE_FEATURE_DIM, hidden_size=config.get('hidden_size', 128))
  model.to(device)
  optimizer = torch.optim.Adam(model.parameters(), lr=config.get('learning_rate', 1e-3))

  best_loss = float('inf')
  os.makedirs(os.path.dirname(config['save_path']), exist_ok=True)
  double_weight = config.get('double_loss_weight', 0.5)

  for epoch in range(config.get('epochs', 5)):
    train_metrics = train_epoch(model, train_loader, optimizer, device, double_weight)
    eval_metrics = eval_epoch(model, val_loader, device, double_weight)
    loss_value = eval_metrics['move_loss'] + double_weight * eval_metrics['double_loss']

    print(
      f"Epoch {epoch + 1}: "
      f"train_move_loss={train_metrics['move_loss']:.4f} "
      f"train_double_loss={train_metrics['double_loss']:.4f} "
      f"val_move_loss={eval_metrics['move_loss']:.4f} "
      f"val_double_loss={eval_metrics['double_loss']:.4f} "
      f"val_move_acc={eval_metrics['move_acc']:.3f} "
      f"val_double_acc={eval_metrics['double_acc']:.3f}"
    )

    if loss_value < best_loss:
      best_loss = loss_value
      torch.save({
        'model_state': model.state_dict(),
        'config': config
      }, config['save_path'])

  print(f"Saved best model to {config['save_path']}")


if __name__ == '__main__':
  main()
