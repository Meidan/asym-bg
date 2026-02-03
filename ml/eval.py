import argparse
import json
import numpy as np
import torch
from torch.utils.data import DataLoader
import torch.nn.functional as F

from dataset import AsymParquetDataset, collate_batch, MOVE_FEATURE_DIM
from model import AsymPolicyModel


def load_checkpoint(path: str):
  payload = torch.load(path, map_location='cpu')
  return payload['model_state'], payload.get('config', {})


def main():
  parser = argparse.ArgumentParser()
  parser.add_argument('--data', default='data/asymmetric-training.parquet')
  parser.add_argument('--checkpoint', default='ml/checkpoints/asym_policy.pt')
  parser.add_argument('--batch-size', type=int, default=256)
  parser.add_argument('--device', default='auto')
  args = parser.parse_args()

  state_dict, config = load_checkpoint(args.checkpoint)
  dataset = AsymParquetDataset(args.data)
  loader = DataLoader(dataset, batch_size=args.batch_size, shuffle=False, collate_fn=collate_batch)

  if args.device == 'auto':
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
  else:
    device = torch.device(args.device)

  model = AsymPolicyModel(state_dim=len(dataset[0].state), move_dim=MOVE_FEATURE_DIM, hidden_size=config.get('hidden_size', 128))
  model.load_state_dict(state_dict)
  model.to(device)
  model.eval()

  move_loss_total = 0.0
  move_batches = 0
  move_correct = 0
  move_total = 0
  double_loss_total = 0.0
  double_batches = 0
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
        loss = F.cross_entropy(scores, chosen)
        move_loss_total += loss.item()
        move_batches += 1
        preds = scores.argmax(dim=1)
        move_correct += (preds == chosen).sum().item()
        move_total += chosen.size(0)

      if 'double' in batch:
        double_batch = batch['double']
        state = double_batch['state'].to(device)
        decision = double_batch['decision'].to(device)
        logits = model.double_logits(state)
        loss = F.binary_cross_entropy_with_logits(logits, decision)
        double_loss_total += loss.item()
        double_batches += 1
        preds = (torch.sigmoid(logits) >= 0.5).float()
        double_correct += (preds == decision).sum().item()
        double_total += decision.size(0)

  print(f"Move loss: {move_loss_total / max(1, move_batches):.4f}")
  print(f"Move accuracy: {move_correct / max(1, move_total):.3f}")
  print(f"Double loss: {double_loss_total / max(1, double_batches):.4f}")
  print(f"Double accuracy: {double_correct / max(1, double_total):.3f}")


if __name__ == '__main__':
  main()
