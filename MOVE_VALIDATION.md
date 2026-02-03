# Move Validation (Short)

The engine uses a depth‑first search to generate all legal move sequences, then filters to those that use the maximum number of dice. It enforces:
- Bar entry priority
- Blocking rules (2+ opposing checkers)
- Hitting blots
- Bearing off requirements (including waste dice)
- Doubles (4 moves)
- Maximal dice usage

Key API:
- `getLegalMoves(state)` returns all valid move sequences.
- `validateAndApplyMoves(state, moves)` validates a sequence and applies it.

This logic is used server‑side for authoritative validation and client‑side for move previews only.
