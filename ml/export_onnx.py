import argparse
import json
import os

import torch

from model import AsymValueModel


class ValueWrapper(torch.nn.Module):
  def __init__(self, model: AsymValueModel):
    super().__init__()
    self.model = model

  def forward(self, state: torch.Tensor) -> torch.Tensor:
    return self.model.value(state)


class DoubleWrapper(torch.nn.Module):
  def __init__(self, model: AsymValueModel):
    super().__init__()
    self.model = model

  def forward(self, state: torch.Tensor) -> torch.Tensor:
    return self.model.double_logits(state)


def main():
  parser = argparse.ArgumentParser()
  parser.add_argument('--checkpoint', default='ml/checkpoints/asym_value.pt')
  parser.add_argument('--config', default='ml/config.json')
  parser.add_argument('--out-dir', default='ml/checkpoints')
  args = parser.parse_args()

  with open(args.config, 'r', encoding='utf-8') as f:
    config = json.load(f)

  state_dim = config.get('state_dim', 73)
  hidden_size = config.get('hidden_size', 128)

  payload = torch.load(args.checkpoint, map_location='cpu')
  model = AsymValueModel(state_dim=state_dim, hidden_size=hidden_size)
  model.load_state_dict(payload['model_state'])
  model.eval()

  os.makedirs(args.out_dir, exist_ok=True)
  value_path = os.path.join(args.out_dir, 'asym_value.onnx')
  double_path = os.path.join(args.out_dir, 'asym_value_double.onnx')

  state = torch.zeros(1, state_dim, dtype=torch.float32)

  value_wrapper = ValueWrapper(model)
  torch.onnx.export(
    value_wrapper,
    state,
    value_path,
    input_names=['state'],
    output_names=['value'],
    dynamic_axes={
      'state': {0: 'batch'},
      'value': {0: 'batch'}
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

  print(f"Exported {value_path} and {double_path}")


if __name__ == '__main__':
  main()
