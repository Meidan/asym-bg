# Multiplayer Backgammon

Real‑time multiplayer backgammon with match play, timers, and an asymmetric variant. The server is authoritative for all game state, dice rolls, and move validation. Clients render state and can use the engine only for local previews.

## Features
- WebSocket multiplayer (two players per game)
- Match play (limited or unlimited) with Crawford rule
- Asymmetric variant (foresight vs doubling roles)
- Server‑authoritative state, dice, and validation
- Time controls (bank + per‑turn delay)

## Quick Start (Dev)
```bash
npm install
npm start
```
- UI: http://localhost:5173
- WebSocket: ws://localhost:8080
- Health: http://localhost:8081/health

Run separately if you prefer:
```bash
npm run server
npm run dev
```

## Protocol (Current)
Client → Server:
- `ROLL_REQUEST`
- `MOVE_REQUEST` (move sequence)
- `DOUBLE_OFFER`
- `DOUBLE_RESPONSE`
- `LEAVE_GAME`

Server → Client:
- `STATE_UPDATE` (authoritative state + match data)
- `TIMER_UPDATE`
- `TIMEOUT`
- `ERROR`

## Architecture (Current)
- **Server (`server.js`)** owns all game state and match logic.
- **Engine (`src/engine`)** is used by the server for validation and state transitions.
- **Client** sends action requests and renders server state; it may compute legal‑move previews for UX only.

## Asymmetric Variant
- **Foresight player**: rolls dice for both players and can see both sets.
- **Doubling player**: owns the cube and may double on their turn.

## Docker
```bash
docker-compose up -d
```
- App: http://localhost:3000
- WebSocket: ws://localhost:8080
- Health: http://localhost:8081/health

## ML Bootstrap (Asymmetric)
Generate training data:
```bash
node scripts/generate-training-data.js
```
Defaults to 4 threads and writes shards under `data/asymmetric-training/`.
Set `THREADS` and `OUTPUT` to customize.

Train + export ONNX:
```bash
conda install --yes --file ml/requirements.txt
python ml/train.py --config ml/config.json
python ml/export_onnx.py --checkpoint ml/checkpoints/asym_policy.pt --config ml/config.json
```

Evaluate vs heuristic:
```bash
node scripts/eval-vs-heuristic.js
```

Evaluate model vs model (self-play):
```bash
node scripts/eval-selfplay.js
```

Enable model bot on server:
```
BOT_POLICY=model
BOT_MODEL_MOVE_PATH=ml/checkpoints/asym_policy_move.onnx
BOT_MODEL_DOUBLE_PATH=ml/checkpoints/asym_policy_double.onnx
```
Note: `onnxruntime-node` is an optional dependency. If it isn’t available (common on Alpine), the server falls back to heuristics.

Heuristic bot options (server):
```
BOT_HEURISTIC_POLICY=gnubg
BOT_GNUBG_TIMEOUT_MS=8000
GNUBG_PATH=gnubg
```
`gnubg` uses cubeless equity for the foresight role and cubeful equity for the doubling role.

Heuristic policy for scripts:
```
HEURISTIC_POLICY=gnubg node scripts/simulate-asymmetric.js
GNUBG_TIMEOUT_MS=8000 node scripts/eval-vs-heuristic.js
```

## Notes
- No persistence yet (in‑memory games only).
- WebSocket URL can be overridden with `VITE_WS_URL` on the client.
