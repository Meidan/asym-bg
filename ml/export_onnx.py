import argparse
import json
import os

import torch

from model import AsymPolicyModel
from dataset import MOVE_FEATURE_DIM


class MoveWrapper(torch.nn.Module):
  def __init__(self, model: AsymPolicyModel):
    super().__init__()
    self.model = model

  def forward(self, state: torch.Tensor, moves: torch.Tensor) -> torch.Tensor:
    return self.model.score_moves(state, moves)


class DoubleWrapper(torch.nn.Module):
  def __init__(self, model: AsymPolicyModel):
    super().__init__()
    self.model = model

  def forward(self, state: torch.Tensor) -> torch.Tensor:
    return self.model.double_logits(state)


def main():
  parser = argparse.ArgumentParser()
  parser.add_argument('--checkpoint', default='ml/checkpoints/asym_policy.pt')
  parser.add_argument('--config', default='ml/config.json')
  parser.add_argument('--out-dir', default='ml/checkpoints')
  args = parser.parse_args()

  with open(args.config, 'r', encoding='utf-8') as f:
    config = json.load(f)

  state_dim = config.get('state_dim', 73)
  hidden_size = config.get('hidden_size', 128)

  payload = torch.load(args.checkpoint, map_location='cpu')
  model = AsymPolicyModel(state_dim=state_dim, move_dim=MOVE_FEATURE_DIM, hidden_size=hidden_size)
  model.load_state_dict(payload['model_state'])
  model.eval()

  os.makedirs(args.out_dir, exist_ok=True)
  move_path = os.path.join(args.out_dir, 'asym_policy_move.onnx')
  double_path = os.path.join(args.out_dir, 'asym_policy_double.onnx')

  state = torch.zeros(1, state_dim, dtype=torch.float32)
  moves = torch.zeros(1, 1, MOVE_FEATURE_DIM, dtype=torch.float32)

  move_wrapper = MoveWrapper(model)
  torch.onnx.export(
    move_wrapper,
    (state, moves),
    move_path,
    input_names=['state', 'moves'],
    output_names=['scores'],
    dynamic_axes={
      'state': {0: 'batch'},
      'moves': {0: 'batch', 1: 'num_moves'},
      'scores': {0: 'batch', 1: 'num_moves'}
    },
    opset_version=17
  )

  double_wrapper = DoubleWrapper(model)
  torch.onnx.export(
    double_wrapper,
    state,
    double_path,
    input_names=['state'],
    output_names=['logits'],
    dynamic_axes={'state': {0: 'batch'}, 'logits': {0: 'batch'}},
    opset_version=17
  )

  print(f"Exported {move_path} and {double_path}")


if __name__ == '__main__':
  main()
