require('ts-node').register({
  transpileOnly: true,
  skipProject: true,
  compilerOptions: {
    module: 'CommonJS',
    moduleResolution: 'node',
    target: 'ES2020'
  }
});

const WebSocket = require('ws');
const { randomBytes } = require('crypto');
const http = require('http');

const {
  createGame,
  rollForFirst,
  rollTurn,
  makeMove,
  offerDouble,
  respondToDouble
} = require('./src/engine/game');
const { hasLegalMoves } = require('./src/engine/moves');
const { createMatch, updateMatchScore, canOfferDoubleNow } = require('./src/engine/match');
const { getOpponent } = require('./src/engine/board');
const { stepAutomatedTurn } = require('./src/engine/automation');
const { createAsymmetricBotController } = require('./src/bot/controllers');

const PORT = process.env.WS_PORT || 8080;
const HEALTH_PORT = process.env.HEALTH_PORT || 8081;
const DEFAULT_TIME_PER_POINT_MS = Number(process.env.TIME_PER_POINT_MS) || 60_000;
const DEFAULT_UNLIMITED_TIME_MS = Number(process.env.UNLIMITED_TIME_MS) || 60_000;
const DEFAULT_TURN_DELAY_MS = Number(process.env.TURN_DELAY_MS) || 5_000;
const BOT_ACCEPT_RATE = 0.5;
const BOT_HUMAN_DELAY_MS = 500;
const BOT_POLICY = process.env.BOT_POLICY || 'heuristic';
const BOT_HEURISTIC_POLICY = process.env.BOT_HEURISTIC_POLICY || 'gnubg';
const BOT_GNUBG_TIMEOUT_RAW = Number(process.env.BOT_GNUBG_TIMEOUT_MS);
const BOT_GNUBG_TIMEOUT_MS = Number.isFinite(BOT_GNUBG_TIMEOUT_RAW) ? BOT_GNUBG_TIMEOUT_RAW : undefined;
const BOT_MODEL_MOVE_PATH = process.env.BOT_MODEL_MOVE_PATH || '';
const BOT_MODEL_DOUBLE_PATH = process.env.BOT_MODEL_DOUBLE_PATH || '';

const healthServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'healthy',
      uptime: process.uptime(),
      activeGames: games.size,
      pendingGames: pendingGames.size,
      timestamp: new Date().toISOString()
    }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

healthServer.listen(HEALTH_PORT, () => {
  console.log(`[${new Date().toISOString()}] Health check server running on port ${HEALTH_PORT}`);
});

const wss = new WebSocket.Server({ port: PORT });

const games = new Map();
const pendingGames = new Map();
const healthSockets = new Set();
const pendingTimeouts = new Set();
let timerInterval = null;

console.log(`[${new Date().toISOString()}] WebSocket server starting...`);

healthServer.on('connection', (socket) => {
  healthSockets.add(socket);
  socket.on('close', () => healthSockets.delete(socket));
});

function generateGameId() {
  return randomBytes(6).toString('hex');
}

function sendTo(ws, message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function broadcast(game, message, exclude = null) {
  if (game.white && game.white !== exclude) {
    sendTo(game.white, message);
  }
  if (game.black && game.black !== exclude) {
    sendTo(game.black, message);
  }
}

wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      switch (message.type) {
        case 'CREATE_GAME':
          handleCreateGame(ws, message);
          break;
        case 'JOIN_GAME':
          handleJoinGame(ws, message);
          break;
        case 'ROLL_REQUEST':
          handleRollRequest(ws, message);
          break;
        case 'MOVE_REQUEST':
          handleMoveRequest(ws, message);
          break;
        case 'DOUBLE_OFFER':
          handleDoubleOffer(ws, message);
          break;
        case 'DOUBLE_RESPONSE':
          handleDoubleResponse(ws, message);
          break;
        case 'PREVIEW_UPDATE':
          handlePreviewUpdate(ws, message);
          break;
        case 'LEAVE_GAME':
          handleLeaveGame(ws, message);
          break;
      }
    } catch (error) {
      sendTo(ws, { type: 'ERROR', error: error.message });
    }
  });

  ws.on('close', () => {
    for (const [gameId, game] of games.entries()) {
      if (game.white === ws || game.black === ws) {
        broadcast(game, {
          type: 'PLAYER_DISCONNECTED',
          player: game.white === ws ? 'white' : 'black'
        }, ws);
        games.delete(gameId);
      }
    }

    for (const [gameId, game] of pendingGames.entries()) {
      if (game.white === ws) {
        pendingGames.delete(gameId);
      }
    }
  });
});

function handleCreateGame(ws, message) {
  const gameId = generateGameId();
  const { variant = 'standard', matchType = 'unlimited', targetScore, timeControl, vsBot } = message;
  const sanitizedTimeControl = sanitizeTimeControl(timeControl, matchType, targetScore);
  const initialBankMs = matchType === 'limited' && targetScore
    ? sanitizedTimeControl.perPointMs * targetScore
    : sanitizedTimeControl.unlimitedMs;

  const game = {
    id: gameId,
    white: ws,
    black: null,
    bot: vsBot ? { player: 'black', acceptRate: BOT_ACCEPT_RATE } : null,
    botDelayMs: vsBot ? BOT_HUMAN_DELAY_MS : 0,
    variant,
    matchType,
    targetScore,
    state: null,
    match: null,
    timeControl: sanitizedTimeControl,
    timers: {
      whiteBankMs: initialBankMs,
      blackBankMs: initialBankMs,
      delayRemainingMs: sanitizedTimeControl.delayMs,
      activePlayer: null,
      lastTickMs: null
    },
    pendingDoubleOfferer: null,
    matchOver: false
  };

  sendTo(ws, {
    type: 'GAME_CREATED',
    gameId,
    player: 'white',
    variant,
    matchType,
    targetScore,
    timeControl: sanitizedTimeControl,
    vsBot: Boolean(vsBot)
  });

  if (vsBot) {
    games.set(gameId, game);
    sendTo(ws, { type: 'PLAYER_JOINED', gameId, bot: true });
    initializeMatch(game);
    advanceAutoFlow(game);
    sendGameState(game);
    syncTimersForState(game);
    enqueueBotAction(game);
    return;
  }

  pendingGames.set(gameId, game);
}

function handleJoinGame(ws, message) {
  const { gameId } = message;

  if (!pendingGames.has(gameId)) {
    sendTo(ws, { type: 'ERROR', error: 'Game not found or already started' });
    return;
  }

  const game = pendingGames.get(gameId);
  if (game.black) {
    sendTo(ws, { type: 'ERROR', error: 'Game already has two players' });
    return;
  }

  game.black = ws;
  pendingGames.delete(gameId);
  games.set(gameId, game);

  sendTo(ws, {
    type: 'GAME_JOINED',
    gameId,
    player: 'black',
    variant: game.variant,
    matchType: game.matchType,
    targetScore: game.targetScore,
    timeControl: game.timeControl
  });

  sendTo(game.white, { type: 'PLAYER_JOINED', gameId });

  initializeMatch(game);
  advanceAutoFlow(game);
  sendGameState(game);
  syncTimersForState(game);
}

function handleRollRequest(ws, message) {
  const game = getActiveGame(ws, message.gameId);
  if (!game) return;

  const player = getPlayerForWs(game, ws);
  if (!player) return;

  if (game.pendingDoubleOfferer) {
    return sendTo(ws, { type: 'ERROR', error: 'Double is pending' });
  }

  if (!game.state || game.state.phase !== 'rolling') {
    return sendTo(ws, { type: 'ERROR', error: 'Not in rolling phase' });
  }

  if (game.state.currentPlayer !== player) {
    return sendTo(ws, { type: 'ERROR', error: 'Not your turn' });
  }

  game.state = rollTurn(game.state);
  advanceAutoFlow(game);
  sendGameState(game);
  syncTimersForState(game);
  enqueueBotAction(game);
}

function handleMoveRequest(ws, message) {
  const game = getActiveGame(ws, message.gameId);
  if (!game) return;

  const player = getPlayerForWs(game, ws);
  if (!player) return;

  if (game.pendingDoubleOfferer) {
    return sendTo(ws, { type: 'ERROR', error: 'Double is pending' });
  }

  if (!game.state || game.state.phase !== 'moving') {
    return sendTo(ws, { type: 'ERROR', error: 'Not in moving phase' });
  }

  if (game.state.currentPlayer !== player) {
    return sendTo(ws, { type: 'ERROR', error: 'Not your turn' });
  }

  const moves = Array.isArray(message.moves) ? message.moves : [];
  const result = makeMove(game.state, moves);
  if (!result.valid || !result.newState) {
    return sendTo(ws, { type: 'ERROR', error: result.error || 'Invalid move' });
  }

  game.state = result.newState;
  advanceAutoFlow(game);
  sendGameState(game);
  syncTimersForState(game);
  enqueueBotAction(game);

  if (game.state.winner) {
    finalizeGame(game);
  }
}

function handleDoubleOffer(ws, message) {
  const game = getActiveGame(ws, message.gameId);
  if (!game) return;

  const player = getPlayerForWs(game, ws);
  if (!player) return;

  if (!game.state) {
    return sendTo(ws, { type: 'ERROR', error: 'Game not started' });
  }

  if (game.pendingDoubleOfferer) {
    return sendTo(ws, { type: 'ERROR', error: 'Double is pending' });
  }

  if (!game.match || !canOfferDoubleNow(game.match, game.state, player)) {
    return sendTo(ws, { type: 'ERROR', error: 'Doubling not allowed' });
  }

  game.state = offerDouble(game.state);
  game.pendingDoubleOfferer = player;
  sendGameState(game);
  syncTimersForState(game);
  enqueueBotAction(game);
}

function handleDoubleResponse(ws, message) {
  const game = getActiveGame(ws, message.gameId);
  if (!game) return;

  const player = getPlayerForWs(game, ws);
  if (!player) return;

  if (!game.pendingDoubleOfferer) {
    return sendTo(ws, { type: 'ERROR', error: 'No double pending' });
  }

  const offerer = game.pendingDoubleOfferer;
  const responder = getOpponent(offerer);
  if (player !== responder) {
    return sendTo(ws, { type: 'ERROR', error: 'Only responder may accept or decline' });
  }

  const accepted = Boolean(message.accepted);
  game.state = respondToDouble(game.state, accepted);
  game.pendingDoubleOfferer = null;
  advanceAutoFlow(game);
  sendGameState(game);
  syncTimersForState(game);
  enqueueBotAction(game);

  if (!accepted) {
    finalizeGame(game);
  }
}

function handleLeaveGame(ws, message) {
  const { gameId } = message;
  const game = games.get(gameId);
  if (!game) return;
  const player = getPlayerForWs(game, ws);
  if (!player) {
    return sendTo(ws, { type: 'ERROR', error: 'Not a participant in this game' });
  }
  broadcast(game, { type: 'PLAYER_LEFT', player }, ws);
  games.delete(gameId);
}

function handlePreviewUpdate(ws, message) {
  const { gameId, moves } = message;
  const game = games.get(gameId);
  if (!game || !game.state) return;

  const player = getPlayerForWs(game, ws);
  if (!player) return;

  if (game.state.phase !== 'moving') return;
  if (game.state.currentPlayer !== player) return;

  const safeMoves = Array.isArray(moves) ? moves : [];
  broadcast(game, {
    type: 'PREVIEW_UPDATE',
    player,
    moves: safeMoves
  }, ws);
}

function initializeMatch(game) {
  const match = createMatch({
    type: game.matchType,
    targetScore: game.targetScore,
    variant: game.variant
  });
  const state = rollForFirst(createGame({ variant: game.variant, asymmetricRoles: match.asymmetricRoles }));
  game.state = state;
  game.match = match;
  game.pendingDoubleOfferer = null;
  game.matchOver = false;
}

function finalizeGame(game) {
  if (!game.state || !game.match || !game.state.winner) return;

  const points = game.state.pointsAwarded || 1;
  game.match = updateMatchScore(game.match, game.state.winner, points);
  sendGameState(game);

  if (game.match.winner) {
    game.matchOver = true;
    game.timers.activePlayer = null;
    game.timers.lastTickMs = null;
    sendTimerState(game);
    return;
  }

  scheduleTimeout(() => {
    const newState = rollForFirst(createGame({
      variant: game.variant,
      asymmetricRoles: game.match?.asymmetricRoles
    }));
    game.state = newState;
    game.pendingDoubleOfferer = null;
    advanceAutoFlow(game);
    sendGameState(game);
    syncTimersForState(game);
    enqueueBotAction(game);
  }, 2000);
}

function sendGameState(game) {
  if (!game.white && !game.black) return;
  broadcast(game, {
    type: 'STATE_UPDATE',
    state: game.state,
    match: game.match,
    pendingDoubleOfferer: game.pendingDoubleOfferer
  });
}

function getActiveGame(ws, gameId) {
  const game = games.get(gameId);
  if (!game) {
    sendTo(ws, { type: 'ERROR', error: 'Game not found' });
    return null;
  }
  return game;
}

function getPlayerForWs(game, ws) {
  if (game.white === ws) return 'white';
  if (game.black === ws) return 'black';
  sendTo(ws, { type: 'ERROR', error: 'Not a participant in this game' });
  return null;
}

function advanceAutoFlow(game) {
  let iterations = 0;
  while (iterations < 5) {
    let changed = false;
    if (tryAutoPass(game)) changed = true;
    if (tryAutoRoll(game)) changed = true;
    if (!changed) break;
    iterations += 1;
  }
}

function tryAutoPass(game) {
  if (!game.state || game.state.phase !== 'moving') return false;
  if (hasLegalMoves(game.state)) return false;
  const result = makeMove(game.state, []);
  if (!result.valid || !result.newState) return false;
  game.state = result.newState;
  return true;
}

function tryAutoRoll(game) {
  if (!game.state || game.state.phase !== 'rolling') return false;
  if (game.pendingDoubleOfferer) return false;
  const player = game.state.currentPlayer;
  if (game.match && canOfferDoubleNow(game.match, game.state, player)) return false;
  game.state = rollTurn(game.state);
  return true;
}

async function resolveBotPolicy(game) {
  if (!game.bot || !game.state || !game.match) return null;
  if (BOT_POLICY !== 'model') return null;
  if (!BOT_MODEL_MOVE_PATH || !BOT_MODEL_DOUBLE_PATH) {
    if (!game.botModelWarning) {
      console.warn('Model bot requested but BOT_MODEL_MOVE_PATH or BOT_MODEL_DOUBLE_PATH is missing. Falling back to heuristic.');
      game.botModelWarning = true;
    }
    return null;
  }

  if (game.botModelPolicy) return game.botModelPolicy;
  if (game.botModelPolicyPromise) return game.botModelPolicyPromise;

  game.botModelPolicyPromise = createModelPolicy({
    moveModelPath: BOT_MODEL_MOVE_PATH,
    doubleModelPath: BOT_MODEL_DOUBLE_PATH,
    getMatch: () => game.match,
    player: game.bot.player
  })
    .then((policy) => {
      game.botModelPolicy = policy;
      return policy;
    })
    .catch((error) => {
      console.error('Model bot initialization failed:', error?.message || error);
      return null;
    })
    .finally(() => {
      game.botModelPolicyPromise = null;
    });

  return game.botModelPolicyPromise;
}

async function createBotPlayers(game) {
  if (!game.bot || !game.state) return {};
  const botPlayer = game.bot.player;
  const roles = game.state.asymmetricRoles;

  if (game.state.variant === 'asymmetric' && roles) {
    if (!game.botPlannedMoveState) {
      game.botPlannedMoveState = { plannedMoves: null, plannedBoard: null };
    }

    const controller = createAsymmetricBotController(
      botPlayer,
      roles,
      game.botPlannedMoveState
    );

    return botPlayer === 'white' ? { white: controller } : { black: controller };
  }

  const modelPolicy = await resolveBotPolicy(game);
  if (modelPolicy) {
    return botPlayer === 'white' ? { white: modelPolicy } : { black: modelPolicy };
  }

  if (isAsymmetric) {
    const controller = createHeuristicController({
      role: isForesightBot ? 'foresight' : 'doubling',
      policy: BOT_HEURISTIC_POLICY,
      gnubgTimeoutMs: BOT_GNUBG_TIMEOUT_MS
    });
    return botPlayer === 'white' ? { white: controller } : { black: controller };
  }

  const controller = {
    getMove: async (_state, legalMoves) => {
      if (legalMoves.length === 0) return [];
      return legalMoves[Math.floor(Math.random() * legalMoves.length)];
    },
    offerDouble: async () => false,
    acceptDouble: async () => Math.random() < (game.bot.acceptRate ?? BOT_ACCEPT_RATE)
  };

  return botPlayer === 'white' ? { white: controller } : { black: controller };
}

function enqueueBotAction(game) {
  if (!game.bot) return;
  if (game.botThinking) {
    game.botQueued = true;
    return;
  }

  game.botThinking = true;
  const delayMs = Number.isFinite(game.botDelayMs) ? game.botDelayMs : 0;
  scheduleTimeout(() => {
    processBotActions(game)
      .then((shouldContinue) => {
        if (shouldContinue) {
          game.botQueued = true;
        }
      })
      .catch((error) => {
        console.error('Bot action failed:', error?.message || error);
      })
      .finally(() => {
        game.botThinking = false;
        if (game.botQueued) {
          game.botQueued = false;
          enqueueBotAction(game);
        }
      });
  }, Math.max(0, delayMs));
}

async function processBotActions(game) {
  if (!game.bot || !game.state || !game.match || game.matchOver) return false;

  const players = await createBotPlayers(game);
  const result = await stepAutomatedTurn(
    game.match,
    game.state,
    game.pendingDoubleOfferer,
    players
  );

  if (!result.advanced) {
    return false;
  }

  game.state = result.state;
  game.pendingDoubleOfferer = result.pendingDoubleOfferer;

  advanceAutoFlow(game);
  sendGameState(game);
  syncTimersForState(game);

  if (game.state.winner) {
    finalizeGame(game);
    return false;
  }

  return !result.awaitingInput;
}

function syncTimersForState(game) {
  if (game.matchOver) return;

  updateTimer(game);

  const desiredActive = game.pendingDoubleOfferer
    ? getOpponent(game.pendingDoubleOfferer)
    : game.state?.currentPlayer || null;

  if (!desiredActive) return;

  if (game.timers.activePlayer !== desiredActive) {
    setActivePlayer(game, desiredActive);
  } else {
    sendTimerState(game);
  }
}

function setActivePlayer(game, player) {
  updateTimer(game);
  game.timers.activePlayer = player;
  game.timers.delayRemainingMs = game.timeControl.delayMs;
  game.timers.lastTickMs = Date.now();
  sendTimerState(game);
}

function updateTimer(game) {
  if (game.matchOver) return;
  const { activePlayer, lastTickMs } = game.timers;
  if (!activePlayer || !lastTickMs) return;

  const now = Date.now();
  let elapsed = now - lastTickMs;
  if (elapsed <= 0) return;

  if (game.timers.delayRemainingMs > 0) {
    const delayConsumed = Math.min(elapsed, game.timers.delayRemainingMs);
    game.timers.delayRemainingMs -= delayConsumed;
    elapsed -= delayConsumed;
  }

  if (elapsed > 0) {
    if (activePlayer === 'white') {
      game.timers.whiteBankMs = Math.max(0, game.timers.whiteBankMs - elapsed);
    } else {
      game.timers.blackBankMs = Math.max(0, game.timers.blackBankMs - elapsed);
    }
  }

  game.timers.lastTickMs = now;

  const remaining = activePlayer === 'white'
    ? game.timers.whiteBankMs
    : game.timers.blackBankMs;

  if (remaining <= 0) {
    handleTimeout(game, activePlayer);
  }
}

function sendTimerState(game) {
  if (!game.white && !game.black) return;
  broadcast(game, {
    type: 'TIMER_UPDATE',
    timers: {
      whiteBankMs: game.timers.whiteBankMs,
      blackBankMs: game.timers.blackBankMs,
      delayRemainingMs: game.timers.delayRemainingMs,
      delayMs: game.timeControl.delayMs,
      activePlayer: game.timers.activePlayer,
      serverNow: Date.now()
    }
  });
}

function handleTimeout(game, loser) {
  if (game.matchOver) return;
  const winner = getOpponent(loser);
  game.matchOver = true;
  game.timers.activePlayer = null;
  game.timers.lastTickMs = null;

  if (game.match) {
    game.match.winner = winner;
  }

  broadcast(game, {
    type: 'TIMEOUT',
    winner,
    loser
  });

  sendGameState(game);
}

function sanitizeTimeControl(timeControl, matchType, targetScore) {
  const perPointMs = clampNumber(timeControl?.perPointMs, 10_000, 10 * 60_000, DEFAULT_TIME_PER_POINT_MS);
  const unlimitedMs = clampNumber(timeControl?.unlimitedMs, 10_000, 60 * 60_000, DEFAULT_UNLIMITED_TIME_MS);
  const delayMs = clampNumber(timeControl?.delayMs, 0, 60_000, DEFAULT_TURN_DELAY_MS);
  const basePerPointMs = matchType === 'limited' && targetScore ? perPointMs : DEFAULT_TIME_PER_POINT_MS;

  return {
    perPointMs: basePerPointMs,
    unlimitedMs,
    delayMs
  };
}

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

function scheduleTimeout(fn, delayMs) {
  const handle = setTimeout(() => {
    pendingTimeouts.delete(handle);
    fn();
  }, delayMs);
  pendingTimeouts.add(handle);
  return handle;
}

timerInterval = setInterval(() => {
  for (const game of games.values()) {
    if (
      game.bot &&
      !game.matchOver &&
      game.state?.variant === 'asymmetric' &&
      game.state.currentPlayer === game.bot.player &&
      !game.pendingDoubleOfferer &&
      !game.botThinking &&
      !game.botQueued
    ) {
      enqueueBotAction(game);
    }
    updateTimer(game);
    if (!game.matchOver && game.timers.activePlayer) {
      sendTimerState(game);
    }
  }
}, 200);

console.log(`[${new Date().toISOString()}] WebSocket server running on ws://localhost:${PORT}`);
console.log(`[${new Date().toISOString()}] Environment: ${process.env.NODE_ENV || 'development'}`);

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[${new Date().toISOString()}] Received ${signal}. Shutting down...`);

  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  for (const timeout of pendingTimeouts) {
    clearTimeout(timeout);
  }
  pendingTimeouts.clear();

  shutdownGnubg();

  for (const client of wss.clients) {
    try {
      client.terminate();
    } catch (error) {
      // Ignore cleanup errors during shutdown
    }
  }

  for (const socket of healthSockets) {
    try {
      socket.destroy();
    } catch (error) {
      // Ignore cleanup errors during shutdown
    }
  }

  const closeTasks = [
    new Promise((resolve) => healthServer.close(resolve)),
    new Promise((resolve) => wss.close(resolve))
  ];

  Promise.allSettled(closeTasks).finally(() => process.exit(0));

  setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
