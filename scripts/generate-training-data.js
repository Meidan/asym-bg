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
const { createMatch } = require('../src/engine/match');
const { runAutomatedMatch } = require('../src/engine/automation');
const { encodeState, serializeLegalMoves, serializeMoveSequence, STATE_VECTOR_LENGTH } = require('../src/engine/encode');
const { createHeuristicController } = require('../src/bot/heuristics');

const MATCHES = Number(process.env.MATCHES) || 100;
const TARGET_SCORE = Number(process.env.TARGET_SCORE) || 5;
const THREADS = Math.max(1, Number(process.env.THREADS) || 4);
const OUTPUT_PATH = process.env.OUTPUT || path.join('data', 'asymmetric-training.parquet');
const FORESIGHT_PLAYER = process.env.FORESIGHT_PLAYER || 'white';
const DOUBLING_PLAYER = process.env.DOUBLING_PLAYER || 'black';
const HEURISTIC_POLICY = (process.env.HEURISTIC_POLICY || 'simple').toLowerCase() === 'gnubg'
  ? 'gnubg'
  : 'simple';
const GNUBG_TIMEOUT_RAW = Number(process.env.GNUBG_TIMEOUT_MS);
const GNUBG_TIMEOUT_MS = Number.isFinite(GNUBG_TIMEOUT_RAW) ? GNUBG_TIMEOUT_RAW : undefined;

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
  ply_index: { type: 'INT32' }
});

function buildPlayers(roles) {
  const makeController = (role) => createHeuristicController({
    role,
    policy: HEURISTIC_POLICY,
    gnubgTimeoutMs: GNUBG_TIMEOUT_MS
  });

  const controllers = {
    foresight: makeController('foresight'),
    doubling: makeController('doubling')
  };

  const players = {};
  players[roles.foresightPlayer] = controllers.foresight;
  players[roles.doublingPlayer] = controllers.doubling;
  return players;
}

function resolveOutputPath(basePath, workerId, threads) {
  if (threads <= 1) {
    return basePath;
  }
  const dir = basePath.endsWith('.parquet')
    ? basePath.slice(0, -'.parquet'.length)
    : basePath;
  return path.join(dir, `part-${String(workerId).padStart(4, '0')}.parquet`);
}

async function runMatches(matchCount, startIndex, outputPath, workerId) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const writer = await parquet.ParquetWriter.openFile(schema, outputPath);
  let totalRows = 0;

  for (let matchIndex = 0; matchIndex < matchCount; matchIndex += 1) {
    const globalMatchIndex = startIndex + matchIndex;
    const roles = {
      foresightPlayer: FORESIGHT_PLAYER,
      doublingPlayer: DOUBLING_PLAYER
    };

    let plyIndex = 0;
    const pendingRows = [];

    const match = createMatch({
      type: 'limited',
      targetScore: TARGET_SCORE,
      variant: 'asymmetric',
      asymmetricRoles: roles
    });

    const players = buildPlayers(roles);

    const hooks = {
      onGameStart: () => {
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

        pendingRows.push({
          state: stateVec,
          action_type: actionType,
          player,
          role,
          legal_moves: legalMovesSerialized,
          chosen_index: chosenIndex,
          decision: typeof decision === 'boolean' ? decision : null,
          match_index: globalMatchIndex,
          game_index: match.currentGame,
          ply_index: plyIndex
        });

        plyIndex += 1;
        totalRows += 1;
      }
    };

    if ((matchIndex + 1) % (MATCHES /100) === 0) {
      const prefix = workerId !== null ? `[worker ${workerId}] ` : '';
      console.log(`${prefix}Awaiting ${matchIndex + 1} / ${matchCount} matches (${totalRows} rows)`);
    }

    await runAutomatedMatch(match, players, undefined, hooks);

    for (const row of pendingRows) {
      await writer.appendRow(row);
    }

    if ((matchIndex + 1) % (MATCHES /100) === 0) {
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
    console.error('Data generation failed:', err);
    process.exitCode = 1;
  });
} else {
  const { matchCount, startIndex, outputBase, workerId, threads } = workerData;
  const outputPath = resolveOutputPath(outputBase, workerId, threads);
  runMatches(matchCount, startIndex, outputPath, workerId)
    .then((result) => parentPort.postMessage(result))
    .catch((err) => {
      console.error('Worker data generation failed:', err);
      process.exitCode = 1;
    });
}
