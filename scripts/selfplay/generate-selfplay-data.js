require('ts-node').register({
  transpileOnly: true,
  skipProject: true,
  compilerOptions: {
    module: 'CommonJS',
    moduleResolution: 'node',
    target: 'ES2020'
  }
});

const path = require('path');
const fs = require('fs');
const parquet = require('parquetjs-lite');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { createMatch } = require('../../src/engine/match');
const { runAutomatedMatch } = require('../../src/engine/automation');
const { encodeState, serializeLegalMoves, serializeMoveSequence, STATE_VECTOR_LENGTH } = require('../../src/engine/encode');
const { createModelPolicy } = require('../../src/bot/modelPolicy');

const MATCHES = Number(process.env.MATCHES) || 50;
const TARGET_SCORE = Number(process.env.TARGET_SCORE) || 5;
const THREADS = Math.max(1, Number(process.env.THREADS) || 1);
const OUTPUT_PATH = process.env.OUTPUT || path.join('data', 'asymmetric-selfplay.parquet');
const FORESIGHT_PLAYER = process.env.FORESIGHT_PLAYER || 'white';
const DOUBLING_PLAYER = process.env.DOUBLING_PLAYER || 'black';
const RANDOM_ROLES = String(process.env.RANDOM_ROLES || 'false').toLowerCase() === 'true';
const VALUE_MODEL = process.env.VALUE_MODEL || process.env.MOVE_MODEL || 'ml/checkpoints/asym_value.onnx';
const DOUBLE_MODEL = process.env.DOUBLE_MODEL || 'ml/checkpoints/asym_value_double.onnx';
const LOG_EVERY = Number(process.env.LOG_EVERY) || Math.max(1, Math.floor(MATCHES / 100));

const schema = new parquet.ParquetSchema({
  state: { type: 'FLOAT', repeated: true },
  action_type: { type: 'UTF8' },
  player: { type: 'UTF8' },
  role: { type: 'UTF8' },
  legal_moves: { type: 'UTF8', optional: true },
  chosen_index: { type: 'INT32', optional: true },
  decision: { type: 'BOOLEAN', optional: true },
  match_index: { type: 'INT32' },
  game_index: { type: 'INT32' },
  ply_index: { type: 'INT32' },
  game_result: { type: 'FLOAT', optional: true },
  match_result: { type: 'FLOAT', optional: true },
  game_points: { type: 'FLOAT', optional: true },
  match_points: { type: 'FLOAT', optional: true }
});

function resolveOutputPath(basePath, workerId, threads) {
  if (threads <= 1) {
    return basePath;
  }
  const dir = basePath.endsWith('.parquet')
    ? basePath.slice(0, -'.parquet'.length)
    : basePath;
  return path.join(dir, `part-${String(workerId).padStart(4, '0')}.parquet`);
}

function pickRoles() {
  if (RANDOM_ROLES) {
    return Math.random() < 0.5
      ? { foresightPlayer: 'white', doublingPlayer: 'black' }
      : { foresightPlayer: 'black', doublingPlayer: 'white' };
  }
  return { foresightPlayer: FORESIGHT_PLAYER, doublingPlayer: DOUBLING_PLAYER };
}

async function createPolicies(getMatch) {
  const white = await createModelPolicy({
    valueModelPath: VALUE_MODEL,
    doubleModelPath: DOUBLE_MODEL,
    player: 'white',
    getMatch
  });
  const black = await createModelPolicy({
    valueModelPath: VALUE_MODEL,
    doubleModelPath: DOUBLE_MODEL,
    player: 'black',
    getMatch
  });
  return { white, black };
}

async function runMatches(matchCount, startIndex, outputPath, workerId) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const writer = await parquet.ParquetWriter.openFile(schema, outputPath);
  let totalRows = 0;

  let currentMatch = null;
  const policies = await createPolicies(() => currentMatch);

  for (let matchIndex = 0; matchIndex < matchCount; matchIndex += 1) {
    const globalMatchIndex = startIndex + matchIndex;
    const roles = pickRoles();
    const rows = [];
    const rowsByGame = new Map();
    let plyIndex = 0;

    currentMatch = createMatch({
      type: 'limited',
      targetScore: TARGET_SCORE,
      variant: 'asymmetric',
      asymmetricRoles: roles
    });

    const players = { white: policies.white, black: policies.black };

    const hooks = {
      onGameStart: ({ match }) => {
        currentMatch = match;
        plyIndex = 0;
      },
      onDecision: ({ match, state, player, actionType, legalMoves, chosenMoves, decision }) => {
        const role = match.asymmetricRoles?.foresightPlayer === player ? 'foresight' : 'doubling';
        const stateVec = encodeState(state, match, player);
        if (stateVec.length !== STATE_VECTOR_LENGTH) {
          throw new Error(`State vector length mismatch: ${stateVec.length}`);
        }

        let legalMovesSerialized = null;
        let chosenIndex = null;
        if (actionType === 'move') {
          const legalStrings = serializeLegalMoves(legalMoves || []);
          legalMovesSerialized = JSON.stringify(legalStrings);
          if (chosenMoves) {
            const chosenString = serializeMoveSequence(chosenMoves);
            chosenIndex = legalStrings.indexOf(chosenString);
          }
        }

        const row = {
          state: stateVec,
          action_type: actionType,
          player,
          role,
          legal_moves: legalMovesSerialized,
          chosen_index: chosenIndex,
          decision: typeof decision === 'boolean' ? decision : null,
          match_index: globalMatchIndex,
          game_index: match.currentGame,
          ply_index: plyIndex,
          game_result: null,
          match_result: null,
          game_points: null,
          match_points: null
        };

        const idx = rows.length;
        rows.push(row);
        if (!rowsByGame.has(match.currentGame)) {
          rowsByGame.set(match.currentGame, []);
        }
        rowsByGame.get(match.currentGame).push(idx);

        plyIndex += 1;
        totalRows += 1;
      },
      onGameEnd: ({ match, state }) => {
        const gameWinner = state.winner;
        if (!gameWinner) return;
        const points = state.pointsAwarded || 1;
        const gameRows = rowsByGame.get(match.currentGame) || [];
        for (const idx of gameRows) {
          const row = rows[idx];
          row.game_result = row.player === gameWinner ? 1.0 : -1.0;
          row.game_points = row.player === gameWinner ? points : -points;
        }
      }
    };

    if (LOG_EVERY > 0 && (matchIndex + 1) % LOG_EVERY === 0) {
      const prefix = workerId !== null ? `[worker ${workerId}] ` : '';
      console.log(`${prefix}Starting ${matchIndex + 1} / ${matchCount} matches (${totalRows} rows)`);
    }

    const finalMatch = await runAutomatedMatch(currentMatch, players, undefined, hooks);

    if (finalMatch.winner) {
      const winner = finalMatch.winner;
      const winnerPoints = finalMatch.score[winner];
      for (const row of rows) {
        row.match_result = row.player === winner ? 1.0 : -1.0;
        row.match_points = row.player === winner ? winnerPoints : -winnerPoints;
      }
    }

    for (const row of rows) {
      await writer.appendRow(row);
    }

    if (LOG_EVERY > 0 && (matchIndex + 1) % LOG_EVERY === 0) {
      const prefix = workerId !== null ? `[worker ${workerId}] ` : '';
      console.log(`${prefix}Completed ${matchIndex + 1} / ${matchCount} matches (${totalRows} rows)`);
    }
  }

  await writer.close();
  return { totalRows, matchCount, outputPath };
}

function summarizeResults(totalMatches, results, outputBase) {
  const totalRows = results.reduce((sum, item) => sum + item.totalRows, 0);
  const outputDir = THREADS > 1 && outputBase.endsWith('.parquet')
    ? outputBase.slice(0, -'.parquet'.length)
    : outputBase;
  console.log(`Done. Wrote ${totalRows} rows for ${totalMatches} matches to ${outputDir}`);
}

async function runInWorkers() {
  const threads = Math.min(THREADS, MATCHES);
  if (threads <= 1) {
    const outputPath = resolveOutputPath(OUTPUT_PATH, 0, 1);
    const result = await runMatches(MATCHES, 0, outputPath, null);
    summarizeResults(MATCHES, [result], OUTPUT_PATH);
    return;
  }

  const base = Math.floor(MATCHES / threads);
  const remainder = MATCHES % threads;
  const results = [];
  let completed = 0;
  let startIndex = 0;

  for (let i = 0; i < threads; i += 1) {
    const count = base + (i < remainder ? 1 : 0);
    if (count === 0) continue;

    const worker = new Worker(__filename, {
      workerData: {
        matchCount: count,
        startIndex,
        outputBase: OUTPUT_PATH,
        workerId: i,
        threads
      }
    });

    worker.on('message', (payload) => {
      results.push(payload);
      completed += 1;
      if (completed === threads) {
        summarizeResults(MATCHES, results, OUTPUT_PATH);
      }
    });

    worker.on('error', (err) => {
      console.error('Worker error:', err);
      process.exitCode = 1;
    });

    worker.on('exit', (code) => {
      if (code !== 0) {
        console.error(`Worker exited with code ${code}`);
        process.exitCode = 1;
      }
    });

    startIndex += count;
  }
}

if (isMainThread) {
  console.log(`Running ${MATCHES} matches on ${THREADS} threads`);

  runInWorkers().catch((err) => {
    console.error('Self-play data generation failed:', err);
    process.exitCode = 1;
  });
} else {
  const { matchCount, startIndex, outputBase, workerId, threads } = workerData;
  const outputPath = resolveOutputPath(outputBase, workerId, threads);
  runMatches(matchCount, startIndex, outputPath, workerId)
    .then((result) => parentPort.postMessage(result))
    .catch((err) => {
      console.error('Worker self-play generation failed:', err);
      process.exitCode = 1;
    });
}
