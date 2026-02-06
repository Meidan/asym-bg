require('ts-node').register({
  transpileOnly: true,
  skipProject: true,
  compilerOptions: {
    module: 'CommonJS',
    moduleResolution: 'node',
    target: 'ES2020'
  }
});

const { createMatch } = require('../src/engine/match');
const { runAutomatedMatch } = require('../src/engine/automation');
const { createModelPolicy } = require('../src/bot/modelPolicy');
const { createHeuristicController } = require('../src/bot/heuristics');

const MATCHES = Number(process.env.MATCHES) || 200;
const TARGET_SCORE = Number(process.env.TARGET_SCORE) || 5;
const MODEL_ROLE = process.env.MODEL_ROLE || 'foresight'; // foresight | doubling
const MOVE_MODEL = process.env.MOVE_MODEL || 'ml/checkpoints/asym_policy_move.onnx';
const DOUBLE_MODEL = process.env.DOUBLE_MODEL || 'ml/checkpoints/asym_policy_double.onnx';
const HEURISTIC_POLICY = (process.env.HEURISTIC_POLICY || 'simple').toLowerCase() === 'gnubg'
  ? 'gnubg'
  : 'simple';
const GNUBG_TIMEOUT_RAW = Number(process.env.GNUBG_TIMEOUT_MS);
const GNUBG_TIMEOUT_MS = Number.isFinite(GNUBG_TIMEOUT_RAW) ? GNUBG_TIMEOUT_RAW : undefined;

async function createPlayers(match) {
  const roles = match.asymmetricRoles;
  const modelPlayer = MODEL_ROLE === 'doubling' ? roles.doublingPlayer : roles.foresightPlayer;
  const modelPolicy = await createModelPolicy({
    moveModelPath: MOVE_MODEL,
    doubleModelPath: DOUBLE_MODEL,
    getMatch: () => match,
    player: modelPlayer
  });

  const heuristicController = (role) => createHeuristicController({
    role,
    policy: HEURISTIC_POLICY,
    gnubgTimeoutMs: GNUBG_TIMEOUT_MS
  });

  const players = {};
  players[roles.foresightPlayer] = MODEL_ROLE === 'foresight'
    ? modelPolicy
    : heuristicController('foresight');
  players[roles.doublingPlayer] = MODEL_ROLE === 'doubling'
    ? modelPolicy
    : heuristicController('doubling');
  return players;
}

async function run() {
  let modelWins = 0;
  let heuristicWins = 0;

  for (let i = 0; i < MATCHES; i += 1) {
    const match = createMatch({
      type: 'limited',
      targetScore: TARGET_SCORE,
      variant: 'asymmetric',
      asymmetricRoles: {
        foresightPlayer: 'white',
        doublingPlayer: 'black'
      }
    });

    const players = await createPlayers(match);
    const finalMatch = await runAutomatedMatch(match, players);

    const modelPlayer = MODEL_ROLE === 'doubling'
      ? finalMatch.asymmetricRoles.doublingPlayer
      : finalMatch.asymmetricRoles.foresightPlayer;

    if (finalMatch.winner === modelPlayer) {
      modelWins += 1;
    } else {
      heuristicWins += 1;
    }

    const winnerRole = finalMatch.winner === finalMatch.asymmetricRoles.foresightPlayer ? 'foresight' : 'doubling';
    console.log(`Match ${i + 1}: ${winnerRole} wins`);
  }

  const modelPct = (modelWins / MATCHES) * 100;
  const heuristicPct = (heuristicWins / MATCHES) * 100;
  console.log(`Model (${MODEL_ROLE}) wins: ${modelWins} (${modelPct.toFixed(1)}%)`);
  console.log(`Heuristic wins: ${heuristicWins} (${heuristicPct.toFixed(1)}%)`);
}

run().catch((err) => {
  console.error('Evaluation failed:', err);
  process.exitCode = 1;
});
