import { GameEngine } from './engine/game';
import { GameState } from './engine/types';

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function runTest(name: string, testFn: () => void) {
  try {
    testFn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

function testOpeningRollNoDoubles() {
  for (let i = 0; i < 50; i += 1) {
    let game = GameEngine.createGame({ variant: 'standard' });
    game = GameEngine.rollForFirst(game);
    game = GameEngine.rollTurn(game);
    const dice = game.currentPlayer === 'white' ? game.whiteDice : game.blackDice;
    assert(dice, 'Missing dice after rollTurn');
    assert(dice!.die1 !== dice!.die2, 'Opening roll should not be doubles');
  }
}

function testAsymmetricRolesAndCubeOwner() {
  let game = GameEngine.createGame({ variant: 'asymmetric' });
  game = GameEngine.rollForFirst(game);
  assert(game.asymmetricRoles, 'Asymmetric roles should be set');
  const roles = game.asymmetricRoles!;
  assert(roles.foresightPlayer !== roles.doublingPlayer, 'Roles should differ');
  assert(game.doublingCube.owner === roles.doublingPlayer, 'Doubling cube owner should be doubling player');
}

function testDeclineDoubleUsesPriorCubeValue() {
  let game = GameEngine.createGame({ variant: 'standard' });
  game = GameEngine.rollForFirst(game);
  game = GameEngine.offerDouble(game);
  game = GameEngine.respondToDouble(game, false);
  assert(game.winner, 'Winner should be set after declining double');
  assert(game.pointsAwarded === 1, 'Declining double should award prior cube value');
  assert(game.phase === 'gameOver', 'Declining double should end the game');
}

function testPassWhenNoLegalMoves() {
  let game = GameEngine.createGame({ variant: 'standard' });
  game = GameEngine.rollForFirst(game);

  const board = Array(26).fill(null) as GameState['board'];
  board[0] = { player: 'white', count: 1 };
  board[24] = { player: 'black', count: 2 };
  board[23] = { player: 'black', count: 2 };

  game = {
    ...game,
    board,
    phase: 'moving',
    currentPlayer: 'white',
    whiteDice: { die1: 1, die2: 2 },
    blackDice: null,
    unusedDice: [1, 2],
    moveHistory: []
  };

  const result = GameEngine.makeMove(game, []);
  assert(result.valid, 'Passing with no legal moves should be valid');
  assert(result.newState, 'Pass should return new state');
  assert(result.newState!.currentPlayer === 'black', 'Turn should pass to opponent');
  assert(result.newState!.phase === 'rolling', 'Next player should be in rolling phase');
}

function run() {
  runTest('Opening roll never doubles', testOpeningRollNoDoubles);
  runTest('Asymmetric roles and cube owner', testAsymmetricRolesAndCubeOwner);
  runTest('Decline double uses prior cube value', testDeclineDoubleUsesPriorCubeValue);
  runTest('Pass when no legal moves', testPassWhenNoLegalMoves);
  console.log('All critical tests passed.');
}

if (require.main === module) {
  run();
}

export { run };
