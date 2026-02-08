import torch
from torch import nn
from typing import Tuple


class AsymPolicyValueModel(nn.Module):
  def __init__(self, state_dim: int, move_dim: int, hidden_size: int = 128):
    super().__init__()
    self.state_fc = nn.Sequential(
      nn.Linear(state_dim, hidden_size),
      nn.ReLU()
    )
    self.move_fc = nn.Sequential(
      nn.Linear(move_dim, hidden_size),
      nn.ReLU()
    )
    self.score_fc = nn.Linear(hidden_size * 2, 1)
    self.double_fc = nn.Linear(hidden_size, 1)
    self.value_game_fc = nn.Linear(hidden_size, 1)
    self.value_match_fc = nn.Linear(hidden_size, 1)

  def score_moves(self, state: torch.Tensor, moves: torch.Tensor) -> torch.Tensor:
    state_emb = self.state_fc(state)  # [B, H]
    move_emb = self.move_fc(moves)    # [B, M, H]
    state_expanded = state_emb.unsqueeze(1).expand(-1, move_emb.size(1), -1)
    combined = torch.cat([state_expanded, move_emb], dim=-1)
    scores = self.score_fc(combined).squeeze(-1)
    return scores

  def double_logits(self, state: torch.Tensor) -> torch.Tensor:
    state_emb = self.state_fc(state)
    return self.double_fc(state_emb).squeeze(-1)

  def value_logits(self, state: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
    state_emb = self.state_fc(state)
    game = self.value_game_fc(state_emb).squeeze(-1)
    match = self.value_match_fc(state_emb).squeeze(-1)
    return game, match
