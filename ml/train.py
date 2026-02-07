import argparse
import json
import os
import random
import time
from typing import Dict, Any, Tuple

import numpy as np
import torch
from torch.utils.data import DataLoader
import torch.nn.functional as F

from dataset import AsymParquetIterableDataset, collate_batch, MOVE_FEATURE_DIM
from model import AsymPolicyModel


def load_config(path: str) -> Dict[str, Any]:
  with open(path, 'r', encoding='utf-8') as f:
    return json.load(f)


def get_device(config: Dict[str, Any]) -> torch.device:
  requested = config.get('device', 'auto')
  if requested == 'auto':
    return torch.device('cuda' if torch.cuda.is_available() else 'cpu')
  return torch.device(requested)


def train_epoch(
  model,
  loader,
  optimizer,
  device,
  double_weight,
  *,
  use_amp: bool,
  grad_accum_steps: int,
  estimate_steps: int
):
  model.train()
  move_loss_total = 0.0
  double_loss_total = 0.0
  move_batches = 0
  double_batches = 0
  scaler = torch.amp.GradScaler(device.type, enabled=use_amp)
  accum_steps = 0
  estimate_steps = max(0, int(estimate_steps))
  estimate_started = False
  estimate_start_time = 0.0
  estimate_printed = False

  optimizer.zero_grad(set_to_none=True)

  for batch in loader:
    if estimate_steps > 0 and not estimate_started:
      estimate_start_time = time.perf_counter()
      estimate_started = True
    has_loss = False
    with torch.amp.autocast(device.type, enabled=use_amp):
      loss = 0.0

      if 'move' in batch:
        move_batch = batch['move']
        state = move_batch['state'].to(device)
        moves = move_batch['moves'].to(device)
        mask = move_batch['mask'].to(device)
        chosen = move_batch['chosen'].to(device)

        scores = model.score_moves(state, moves)
        scores = scores.masked_fill(~mask, torch.finfo(scores.dtype).min)
        loss_move = F.cross_entropy(scores, chosen)
        loss = loss + loss_move
        move_loss_total += loss_move.item()
        move_batches += 1
        has_loss = True

      if 'double' in batch:
        double_batch = batch['double']
        state = double_batch['state'].to(device)
        decision = double_batch['decision'].to(device)
        logits = model.double_logits(state)
        loss_double = F.binary_cross_entropy_with_logits(logits, decision)
        loss = loss + double_weight * loss_double
        double_loss_total += loss_double.item()
        double_batches += 1
        has_loss = True

      if not has_loss:
        continue
      loss = loss / max(1, grad_accum_steps)

    scaler.scale(loss).backward()
    accum_steps += 1
    if estimate_steps > 0 and estimate_started and not estimate_printed:
      if accum_steps >= estimate_steps:
        elapsed = time.perf_counter() - estimate_start_time
        est_step_ms = (elapsed / estimate_steps) * 1000.0
        est_epoch_sec = None
        try:
          est_epoch_sec = (len(loader) / estimate_steps) * elapsed
        except TypeError:
          est_epoch_sec = None
        msg = f"Estimated step_time_ms={est_step_ms:.2f}"
        if est_epoch_sec is not None:
          msg += f" estimated_epoch_time_sec={est_epoch_sec:.2f}"
        print(msg)
        estimate_printed = True
    if accum_steps % grad_accum_steps == 0:
      scaler.step(optimizer)
      scaler.update()
      optimizer.zero_grad(set_to_none=True)

  if accum_steps % grad_accum_steps != 0:
    scaler.step(optimizer)
    scaler.update()
    optimizer.zero_grad(set_to_none=True)

  return {
    'move_loss': move_loss_total / max(1, move_batches),
    'double_loss': double_loss_total / max(1, double_batches)
  }


def eval_epoch(model, loader, device, double_weight, *, use_amp: bool):
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
      with torch.amp.autocast(device.type, enabled=use_amp):
        if 'move' in batch:
          move_batch = batch['move']
          state = move_batch['state'].to(device)
          moves = move_batch['moves'].to(device)
          mask = move_batch['mask'].to(device)
          chosen = move_batch['chosen'].to(device)

          scores = model.score_moves(state, moves)
          scores = scores.masked_fill(~mask, torch.finfo(scores.dtype).min)
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


def save_checkpoint(path: str, model, optimizer, epoch: int, best_loss: float):
  checkpoint = {
    'epoch': epoch,
    'best_loss': best_loss,
    'model_state': model.state_dict(),
    'optimizer_state': optimizer.state_dict(),
    'torch_rng_state': torch.get_rng_state(),
    'numpy_rng_state': np.random.get_state(),
    'python_rng_state': random.getstate()
  }
  if torch.cuda.is_available():
    checkpoint['cuda_rng_state'] = torch.cuda.get_rng_state_all()
  torch.save(checkpoint, path)


def load_checkpoint(path: str, model, optimizer, device: torch.device) -> Tuple[int, float]:
  checkpoint = torch.load(path, map_location=device, weights_only=False)
  model.load_state_dict(checkpoint['model_state'])
  optimizer.load_state_dict(checkpoint['optimizer_state'])

  torch.set_rng_state(checkpoint['torch_rng_state'])
  if 'cuda_rng_state' in checkpoint and torch.cuda.is_available():
    torch.cuda.set_rng_state_all(checkpoint['cuda_rng_state'])
  if 'numpy_rng_state' in checkpoint:
    np.random.set_state(checkpoint['numpy_rng_state'])
  if 'python_rng_state' in checkpoint:
    random.setstate(checkpoint['python_rng_state'])

  last_epoch = int(checkpoint.get('epoch', -1))
  best_loss = float(checkpoint.get('best_loss', float('inf')))
  return last_epoch + 1, best_loss


def main():
  parser = argparse.ArgumentParser()
  parser.add_argument('--config', default='ml/config.json')
  parser.add_argument('--resume', nargs='?', const='__auto__', default=None)
  args = parser.parse_args()

  config = load_config(args.config)
  torch.manual_seed(config.get('seed', 42))
  np.random.seed(config.get('seed', 42))

  val_ratio = config.get('eval_split', 0.1)
  seed = config.get('seed', 42)
  batch_rows = config.get('parquet_batch_rows', 4096)
  train_dataset = AsymParquetIterableDataset(
    config['data_path'],
    split='train',
    val_ratio=val_ratio,
    seed=seed,
    batch_rows=batch_rows
  )
  val_dataset = AsymParquetIterableDataset(
    config['data_path'],
    split='val',
    val_ratio=val_ratio,
    seed=seed,
    batch_rows=batch_rows
  )
  train_loader = DataLoader(
    train_dataset,
    batch_size=config.get('batch_size', 128),
    shuffle=False,
    collate_fn=collate_batch
  )
  val_loader = DataLoader(
    val_dataset,
    batch_size=config.get('batch_size', 128),
    shuffle=False,
    collate_fn=collate_batch
  )

  device = get_device(config)
  state_dim = int(config.get('state_dim', 0))
  if state_dim <= 0:
    raise ValueError('state_dim must be set in config when using iterable dataset')
  model = AsymPolicyModel(state_dim=state_dim, move_dim=MOVE_FEATURE_DIM, hidden_size=config.get('hidden_size', 128))
  model.to(device)
  optimizer = torch.optim.Adam(model.parameters(), lr=config.get('learning_rate', 1e-3))

  save_path = config['save_path']
  checkpoint_path = config.get('checkpoint_path', f"{save_path}.ckpt")
  os.makedirs(os.path.dirname(save_path), exist_ok=True)
  os.makedirs(os.path.dirname(checkpoint_path), exist_ok=True)
  double_weight = config.get('double_loss_weight', 0.5)
  use_amp = config.get('use_amp', device.type == 'cuda')
  grad_accum_steps = int(config.get('grad_accum_steps', 1))
  estimate_steps = int(config.get('estimate_steps', 10))

  start_epoch = 0
  best_loss = float('inf')
  if args.resume is not None:
    resume_path = checkpoint_path if args.resume == '__auto__' else args.resume
    if not os.path.exists(resume_path):
      raise FileNotFoundError(f"Checkpoint not found: {resume_path}")
    start_epoch, best_loss = load_checkpoint(resume_path, model, optimizer, device)
    print(f"Resuming from {resume_path} at epoch {start_epoch + 1}")

  for epoch in range(start_epoch, config.get('epochs', 5)):
    train_metrics = train_epoch(
      model,
      train_loader,
      optimizer,
      device,
      double_weight,
      use_amp=use_amp,
      grad_accum_steps=grad_accum_steps,
      estimate_steps=estimate_steps
    )
    eval_metrics = eval_epoch(model, val_loader, device, double_weight, use_amp=use_amp)
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
      }, save_path)

    save_checkpoint(checkpoint_path, model, optimizer, epoch, best_loss)

  print(f"Saved best model to {save_path}")


if __name__ == '__main__':
  main()
