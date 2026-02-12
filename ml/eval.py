import argparse
import json
import numpy as np
import torch
from torch.utils.data import DataLoader
import torch.nn.functional as F

from dataset import AsymParquetDataset, collate_batch
from model import AsymValueModel


def load_checkpoint(path: str):
  payload = torch.load(path, map_location='cpu')
  return payload['model_state'], payload.get('config', {})


def main():
  parser = argparse.ArgumentParser()
  parser.add_argument('--data', default='data/asymmetric-training.parquet')
  parser.add_argument('--checkpoint', default='ml/checkpoints/asym_value.pt')
  parser.add_argument('--batch-size', type=int, default=256)
  parser.add_argument('--device', default='auto')
  parser.add_argument('--value-target', default=None)
  args = parser.parse_args()

  state_dict, config = load_checkpoint(args.checkpoint)
  dataset = AsymParquetDataset(args.data)
  value_target = args.value_target or config.get('value_target', 'game_result')
  loader = DataLoader(
    dataset,
    batch_size=args.batch_size,
    shuffle=False,
    collate_fn=lambda batch: collate_batch(batch, value_target=value_target)
  )

  if args.device == 'auto':
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
  else:
    device = torch.device(args.device)

  model = AsymValueModel(state_dim=len(dataset[0].state), hidden_size=config.get('hidden_size', 128))
  model.load_state_dict(state_dict)
  model.to(device)
  model.eval()

  value_loss_total = 0.0
  value_batches = 0
  double_loss_total = 0.0
  double_batches = 0
  double_correct = 0
  double_total = 0

  with torch.no_grad():
    for batch in loader:
      if 'value' in batch:
        value_batch = batch['value']
        state = value_batch['state'].to(device)
        target = value_batch['target'].to(device)
        pred = model.value(state)
        loss = F.mse_loss(pred, target)
        value_loss_total += loss.item()
        value_batches += 1

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

  print(f"Value loss: {value_loss_total / max(1, value_batches):.4f}")
  print(f"Double loss: {double_loss_total / max(1, double_batches):.4f}")
  print(f"Double accuracy: {double_correct / max(1, double_total):.3f}")


if __name__ == '__main__':
  main()
