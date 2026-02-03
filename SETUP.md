# Setup Guide

## Development
```bash
npm install
npm start
```
- UI: http://localhost:5173
- WebSocket: ws://localhost:8080
- Health: http://localhost:8081/health

Run separately if desired:
```bash
npm run server
npm run dev
```

## Production Build (Frontend)
```bash
npm run build
npm run preview
```

## Environment
- `WS_PORT` (server, default `8080`)
- `HEALTH_PORT` (server, default `8081`)
- `VITE_WS_URL` (client override for WebSocket URL)

## Notes
- The server is authoritative for game state, dice rolls, and validation.
- Clients use the engine only for preview assistance.
