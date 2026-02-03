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
const {
  chooseHeuristicMove,
  chooseForesightMove,
  shouldOfferDouble,
  shouldAcceptDouble
} = require('../src/bot/heuristics');

const MATCHES = Number(process.env.MATCHES) || 12;
const TARGET_SCORE = Number(process.env.TARGET_SCORE) || 5;
const THREADS = Math.max(1, Number(process.env.THREADS) || 4);
const DEFAULT_FORESIGHT_PLAYER = 'white';
const DEFAULT_DOUBLING_PLAYER = 'black';

async function runMatches(matchCount, startIndex) {
  let foresightWins = 0;
  let doublingWins = 0;
  const roles = {
    foresightPlayer: DEFAULT_FORESIGHT_PLAYER,
    doublingPlayer: DEFAULT_DOUBLING_PLAYER
  };
  const players = {
    [roles.foresightPlayer]: {
      getMove: async (state) => chooseForesightMove(state, state.currentPlayer),
      offerDouble: async (state) => shouldOfferDouble(state, state.currentPlayer),
      acceptDouble: async (state) => shouldAcceptDouble(state, state.currentPlayer)
    },
    [roles.doublingPlayer]: {
      getMove: async (state) => chooseHeuristicMove(state, state.currentPlayer),
      offerDouble: async (state) => shouldOfferDouble(state, state.currentPlayer),
      acceptDouble: async (state) => shouldAcceptDouble(state, state.currentPlayer)
    }
  };

  for (let i = 0; i < matchCount; i++) {
    const globalIndex = startIndex + i;
    let match = createMatch({
      type: 'limited',
      targetScore: TARGET_SCORE,
      variant: 'asymmetric',
      asymmetricRoles: roles
    });

    match = await runAutomatedMatch(match, players);

    const roleWinner = match.winner === match.asymmetricRoles.foresightPlayer ? 'foresight' : 'doubling';
    console.log(`Match ${globalIndex + 1}: ${roleWinner} wins`);

    if (roleWinner === 'foresight') {
      foresightWins += 1;
    } else {
      doublingWins += 1;
    }
  }

  return { foresightWins, doublingWins };
}

function summarizeResults(totalMatches, results) {
  const foresightWins = results.reduce((sum, item) => sum + item.foresightWins, 0);
  const doublingWins = results.reduce((sum, item) => sum + item.doublingWins, 0);
  const foresightPct = (foresightWins / totalMatches) * 100;
  const doublingPct = (doublingWins / totalMatches) * 100;

  console.log(`Matches: ${totalMatches} (to ${TARGET_SCORE})`);
  console.log(`Foresight wins: ${foresightWins} (${foresightPct.toFixed(1)}%)`);
  console.log(`Doubling wins: ${doublingWins} (${doublingPct.toFixed(1)}%)`);
}

async function runInWorkers() {
  const threads = Math.min(THREADS, MATCHES);
  if (threads <= 1) {
    const singleResult = await runMatches(MATCHES, 0);
    summarizeResults(MATCHES, [singleResult]);
    return;
  }

  const base = Math.floor(MATCHES / threads);
  const remainder = MATCHES % threads;
  const results = [];
  let completed = 0;
  let startIndex = 0;

  for (let i = 0; i < threads; i++) {
    const count = base + (i < remainder ? 1 : 0);
    if (count === 0) continue;

    const worker = new Worker(__filename, {
      workerData: { matchCount: count, startIndex }
    });

    worker.on('message', (payload) => {
      results.push(payload);
      completed += 1;
      if (completed === threads) {
        summarizeResults(MATCHES, results);
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
  runInWorkers().catch((err) => {
    console.error('Simulation failed:', err);
    process.exitCode = 1;
  });
} else {
  const { matchCount, startIndex } = workerData;
  runMatches(matchCount, startIndex)
    .then((result) => parentPort.postMessage(result))
    .catch((err) => {
      console.error('Worker simulation failed:', err);
      process.exitCode = 1;
    });
}
