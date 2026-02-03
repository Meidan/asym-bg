# Build stage for frontend
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the frontend app
RUN npm run build

# Test stage
FROM node:20-alpine AS test

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Run tests and capture output
RUN mkdir -p /artifacts && \
    set -e && \
    set -o pipefail && \
    npm test | tee /artifacts/test-output.txt

# Production stage
FROM node:20-alpine

# Install wget for healthchecks
RUN apk add --no-cache wget

WORKDIR /app

# Copy package files for server dependencies
COPY package.json package-lock.json* ./

# Install dependencies (ts-node + typescript needed for server runtime)
RUN npm ci

# Copy built frontend from builder
COPY --from=builder /app/dist ./dist

# Copy server and engine sources
COPY server.js ./
COPY src/engine ./src/engine
COPY src/bot ./src/bot

# Create a simple startup script that runs both server and serves frontend
# Install a static file server for the frontend
RUN npm install -g serve

# Create a simple startup script that runs both server and serves frontend
RUN echo '#!/bin/sh' > /app/start.sh && \
    echo 'node server.js &' >> /app/start.sh && \
    echo 'serve -s dist -l 3000' >> /app/start.sh && \
    chmod +x /app/start.sh

# Expose ports
EXPOSE 3000 8080 8081

# Port 3000: Frontend (HTTP)
# Port 8080: WebSocket server
# Port 8081: Health check endpoint

# Start both services
CMD ["/app/start.sh"]
