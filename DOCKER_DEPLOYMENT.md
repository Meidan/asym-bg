# Docker Deployment

## Build and Run
```bash
docker build -t backgammon-app .

docker run -d \
  -p 3000:3000 \
  -p 8080:8080 \
  -p 8081:8081 \
  --name backgammon \
  backgammon-app
```

## Ports
- `3000` HTTP (frontend)
- `8080` WebSocket server
- `8081` Health endpoint

## Environment
- `WS_PORT` (server, default 8080)
- `HEALTH_PORT` (server, default 8081)
- `TIME_PER_POINT_MS`, `UNLIMITED_TIME_MS`, `TURN_DELAY_MS` (timers)

## Notes
- The server keeps state in memory (no persistence yet).
- For production, put a reverse proxy in front of ports 3000/8080.
