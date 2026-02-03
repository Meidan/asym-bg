require('ts-node').register({
  transpileOnly: true,
  skipProject: true,
  compilerOptions: {
    module: 'CommonJS',
    moduleResolution: 'node',
    target: 'ES2020'
  }
});

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { createMatch } = require('../src/engine/match');
const { runAutomatedMatch } = require('../src/engine/automation');
const { createModelPolicy } = require('../src/bot/modelPolicy');

const MATCHES = Number(process.env.MATCHES) || 200;
const TARGET_SCORE = Number(process.env.TARGET_SCORE) || 5;
const THREADS = Math.max(1, Number(process.env.THREADS) || 1);
const ROLE_SPLIT = String(process.env.ROLE_SPLIT || 'true').toLowerCase() !== 'false';
const MODEL_A_ROLE = (process.env.MODEL_A_ROLE || 'foresight').toLowerCase();
const LOG_EVERY = Number(process.env.LOG_EVERY) || 1;

const MODEL_A_NAME = process.env.MODEL_A_NAME || 'modelA';
const MODEL_B_NAME = process.env.MODEL_B_NAME || 'modelB';

const MODEL_A_MOVE = process.env.MODEL_A_MOVE || 'ml/checkpoints/asym_policy_move.onnx';
const MODEL_A_DOUBLE = process.env.MODEL_A_DOUBLE || 'ml/checkpoints/asym_policy_double.onnx';
const MODEL_B_MOVE = process.env.MODEL_B_MOVE || MODEL_A_MOVE;
const MODEL_B_DOUBLE = process.env.MODEL_B_DOUBLE || MODEL_A_DOUBLE;

const DEFAULT_ROLES = {
  foresightPlayer: 'white',
  doublingPlayer: 'black'
};

function assertRole(role) {
  if (role !== 'foresight' && role !== 'doubling') {
    throw new Error(`Invalid role: ${role}`);
  }
  return role;
}

function roleForMatch(index, roleSplit, modelARole) {
  if (roleSplit) {
    return index % 2 === 0 ? 'foresight' : 'doubling';
  }
  return modelARole;
}

function eloDiffFromWinRate(rate) {
  if (rate <= 0) return -Infinity;
  if (rate >= 1) return Infinity;
  return 400 * Math.log10(rate / (1 - rate));
}

async function loadPolicies(config, getMatch) {
  const modelAWhite = await createModelPolicy({
    moveModelPath: config.modelAMove,
    doubleModelPath: config.modelADouble,
    player: 'white',
    getMatch
  });
  const modelABlack = await createModelPolicy({
    moveModelPath: config.modelAMove,
    doubleModelPath: config.modelADouble,
    player: 'black',
    getMatch
  });
  const modelBWhite = await createModelPolicy({
    moveModelPath: config.modelBMove,
    doubleModelPath: config.modelBDouble,
    player: 'white',
    getMatch
  });
  const modelBBlack = await createModelPolicy({
    moveModelPath: config.modelBMove,
    doubleModelPath: config.modelBDouble,
    player: 'black',
    getMatch
  });

  return {
    modelA: { white: modelAWhite, black: modelABlack },
    modelB: { white: modelBWhite, black: modelBBlack }
  };
}

function buildPlayers(policies, roles, modelARole) {
  const players = {};
  if (modelARole === 'foresight') {
    players[roles.foresightPlayer] = policies.modelA[roles.foresightPlayer];
    players[roles.doublingPlayer] = policies.modelB[roles.doublingPlayer];
  } else {
    players[roles.foresightPlayer] = policies.modelB[roles.foresightPlayer];
    players[roles.doublingPlayer] = policies.modelA[roles.doublingPlayer];
  }
  return players;
}

async function runMatches(matchCount, startIndex, config) {
  let currentMatch = null;
  const policies = await loadPolicies(config, () => currentMatch);

  const results = {
    modelAWins: 0,
    modelBWins: 0,
    modelAWinsAsForesight: 0,
    modelAWinsAsDoubling: 0,
    modelBWinsAsForesight: 0,
    modelBWinsAsDoubling: 0,
    modelAAsForesightMatches: 0,
    modelAAsDoublingMatches: 0,
    foresightWins: 0,
    doublingWins: 0
  };

  for (let i = 0; i < matchCount; i += 1) {
    const globalIndex = startIndex + i;
    const modelARole = roleForMatch(globalIndex, config.roleSplit, config.modelARole);
    const roles = config.roles;

    if (modelARole === 'foresight') {
      results.modelAAsForesightMatches += 1;
    } else {
      results.modelAAsDoublingMatches += 1;
    }

    currentMatch = createMatch({
      type: 'limited',
      targetScore: config.targetScore,
      variant: 'asymmetric',
      asymmetricRoles: roles
    });

    const players = buildPlayers(policies, roles, modelARole);
    const finalMatch = await runAutomatedMatch(currentMatch, players);

    const winnerRole = finalMatch.winner === roles.foresightPlayer ? 'foresight' : 'doubling';
    const modelAWon = winnerRole === modelARole;

    if (winnerRole === 'foresight') {
      results.foresightWins += 1;
    } else {
      results.doublingWins += 1;
    }

    if (modelAWon) {
      results.modelAWins += 1;
      if (winnerRole === 'foresight') {
        results.modelAWinsAsForesight += 1;
      } else {
        results.modelAWinsAsDoubling += 1;
      }
    } else {
      results.modelBWins += 1;
      if (winnerRole === 'foresight') {
        results.modelBWinsAsForesight += 1;
      } else {
        results.modelBWinsAsDoubling += 1;
      }
    }

    if (config.logEvery > 0 && (globalIndex + 1) % config.logEvery === 0) {
      const winnerLabel = modelAWon ? config.modelAName : config.modelBName;
      console.log(`Match ${globalIndex + 1}: ${winnerRole} wins (${winnerLabel})`);
    }
  }

  return results;
}

function mergeResults(results) {
  return results.reduce((acc, current) => {
    Object.keys(acc).forEach((key) => {
      acc[key] += current[key] || 0;
    });
    return acc;
  }, {
    modelAWins: 0,
    modelBWins: 0,
    modelAWinsAsForesight: 0,
    modelAWinsAsDoubling: 0,
    modelBWinsAsForesight: 0,
    modelBWinsAsDoubling: 0,
    modelAAsForesightMatches: 0,
    modelAAsDoublingMatches: 0,
    foresightWins: 0,
    doublingWins: 0
  });
}

function summarizeResults(config, results) {
  const total = results.modelAWins + results.modelBWins;
  const modelAWinRate = total > 0 ? results.modelAWins / total : 0;
  const modelBWinRate = total > 0 ? results.modelBWins / total : 0;
  const modelAEloDiff = eloDiffFromWinRate(modelAWinRate);

  console.log(`Matches: ${total} (to ${config.targetScore})`);
  console.log(`${config.modelAName} wins: ${results.modelAWins} (${(modelAWinRate * 100).toFixed(1)}%)`);
  console.log(`${config.modelBName} wins: ${results.modelBWins} (${(modelBWinRate * 100).toFixed(1)}%)`);

  if (Number.isFinite(modelAEloDiff)) {
    const leader = modelAEloDiff >= 0 ? config.modelAName : config.modelBName;
    console.log(`Estimated Elo: ${leader} +${Math.abs(modelAEloDiff).toFixed(1)}`);
  } else {
    console.log('Estimated Elo: insufficient data for a finite estimate');
  }

  console.log(`Foresight wins: ${results.foresightWins} (${((results.foresightWins / total) * 100).toFixed(1)}%)`);
  console.log(`Doubling wins: ${results.doublingWins} (${((results.doublingWins / total) * 100).toFixed(1)}%)`);

  if (results.modelAAsForesightMatches > 0) {
    const rate = results.modelAWinsAsForesight / results.modelAAsForesightMatches;
    console.log(
      `${config.modelAName} as foresight: ${results.modelAWinsAsForesight}/${results.modelAAsForesightMatches}` +
      ` (${(rate * 100).toFixed(1)}%)`
    );
  }

  if (results.modelAAsDoublingMatches > 0) {
    const rate = results.modelAWinsAsDoubling / results.modelAAsDoublingMatches;
    console.log(
      `${config.modelAName} as doubling: ${results.modelAWinsAsDoubling}/${results.modelAAsDoublingMatches}` +
      ` (${(rate * 100).toFixed(1)}%)`
    );
  }
}

async function run() {
  const modelARole = assertRole(MODEL_A_ROLE);
  const config = {
    targetScore: TARGET_SCORE,
    modelARole,
    roleSplit: ROLE_SPLIT,
    modelAName: MODEL_A_NAME,
    modelBName: MODEL_B_NAME,
    modelAMove: MODEL_A_MOVE,
    modelADouble: MODEL_A_DOUBLE,
    modelBMove: MODEL_B_MOVE,
    modelBDouble: MODEL_B_DOUBLE,
    logEvery: LOG_EVERY,
    roles: DEFAULT_ROLES
  };

  if (THREADS <= 1) {
    const result = await runMatches(MATCHES, 0, config);
    summarizeResults(config, result);
    return;
  }

  const threads = Math.min(THREADS, MATCHES);
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
        config
      }
    });

    worker.on('message', (payload) => {
      results.push(payload);
      completed += 1;
      if (completed === threads) {
        const merged = mergeResults(results);
        summarizeResults(config, merged);
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
  run().catch((err) => {
    console.error('Self-play evaluation failed:', err);
    process.exitCode = 1;
  });
} else {
  const { matchCount, startIndex, config } = workerData;
  runMatches(matchCount, startIndex, config)
    .then((result) => parentPort.postMessage(result))
    .catch((err) => {
      console.error('Worker evaluation failed:', err);
      process.exitCode = 1;
    });
}
