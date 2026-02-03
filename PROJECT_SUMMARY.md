# Backgammon Project Summary

## Current State
- **Server‑authoritative multiplayer** via WebSockets (`server.js`).
- **Game engine** in `src/engine` used on the server for rules and validation.
- **Client** renders server state and uses the engine only for move previews.
- **Match play** with Crawford rule and asymmetric variant.
- **Time controls** with bank + per‑turn delay.

## Key Files
- `server.js` — WebSocket server, match/game state, timers.
- `src/engine/` — core backgammon rules and state transitions.
- `src/App.tsx` — main UI, receives server state and sends action requests.
- `src/multiplayer/MultiplayerContext.tsx` — WebSocket client.
- `src/components/Board.tsx` — board rendering and interactions.

## Running
```bash
npm install
npm start
```

## Docker
```bash
docker-compose up -d
```
