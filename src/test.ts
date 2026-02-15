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

function diceEqual(a: { die1: number; die2: number } | null, b: { die1: number; die2: number } | null): boolean {
  if (!a || !b) return false;
  return a.die1 === b.die1 && a.die2 === b.die2;
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
  assert(roles.white === 'foresight' || roles.black === 'foresight', 'At least one player should be foresight');
  const expectedOwner = roles.white === 'doubling'
    ? 'white'
    : roles.black === 'doubling'
      ? 'black'
      : null;
  assert(game.doublingCube.owner === expectedOwner, 'Doubling cube owner should match doubling role');
}

function testRejectDoublingVsDoubling() {
  let threw = false;
  try {
    GameEngine.createGame({
      variant: 'asymmetric',
      asymmetricRoles: { white: 'doubling', black: 'doubling' }
    });
  } catch (_error) {
    threw = true;
  }
  assert(threw, 'Doubling vs Doubling should be rejected');
}

function testForesightVsForesightDiceFlow() {
  let game = GameEngine.createGame({
    variant: 'asymmetric',
    asymmetricRoles: { white: 'foresight', black: 'foresight' }
  });

  game = GameEngine.rollForFirst(game);
  const firstPlayer = game.currentPlayer;
  const secondPlayer = firstPlayer === 'white' ? 'black' : 'white';

  game = GameEngine.rollTurn(game);
  assert(game.phase === 'moving', 'Opening foresight roll should enter moving phase');
  const secondOpeningDice = secondPlayer === 'white' ? game.whiteDice : game.blackDice;
  assert(secondOpeningDice, 'Opening roll should pre-roll the opponent in foresight mirror');
  const firstOpeningDice = firstPlayer === 'white' ? game.whiteDice : game.blackDice;
  assert(firstOpeningDice, 'Opening roll should include current player dice');

  const firstLegal = GameEngine.getLegalMoves(game);
  const firstResult = GameEngine.makeMove(game, firstLegal[0] || []);
  assert(firstResult.valid && firstResult.newState, 'First player move should succeed');
  game = firstResult.newState!;

  assert(game.currentPlayer === secondPlayer, 'Turn should pass to second player');
  assert(game.phase === 'moving', 'Second player should use pre-rolled opening dice');
  const secondCurrentDice = secondPlayer === 'white' ? game.whiteDice : game.blackDice;
  assert(diceEqual(secondCurrentDice, secondOpeningDice), 'Second player should use opening pre-roll');
  const secondSeesOpponentDice = firstPlayer === 'white' ? game.whiteDice : game.blackDice;
  assert(secondSeesOpponentDice, 'Second player should see opponent next roll');

  const secondLegal = GameEngine.getLegalMoves(game);
  const secondResult = GameEngine.makeMove(game, secondLegal[0] || []);
  assert(secondResult.valid && secondResult.newState, 'Second player move should succeed');
  game = secondResult.newState!;

  assert(game.currentPlayer === firstPlayer, 'Turn should pass back to first player');
  assert(game.phase === 'moving', 'In foresight mirror, opponent should pre-roll your next turn');
  const firstCurrentDice = firstPlayer === 'white' ? game.whiteDice : game.blackDice;
  assert(firstCurrentDice, 'First player should have pre-rolled dice after opponent move');
  const firstSeesOpponentDice = secondPlayer === 'white' ? game.whiteDice : game.blackDice;
  assert(firstSeesOpponentDice, 'First player should see opponent next roll');
}

function testForesightVsForesightCubeIsStandard() {
  let game = GameEngine.createGame({
    variant: 'asymmetric',
    asymmetricRoles: { white: 'foresight', black: 'foresight' }
  });

  game = GameEngine.rollForFirst(game);
  game = GameEngine.rollTurn(game);
  const offerer = game.currentPlayer;
  const accepter = offerer === 'white' ? 'black' : 'white';

  game = GameEngine.offerDouble(game);
  assert(game.doublingCube.value === 2, 'Double should increase cube value');

  game = GameEngine.respondToDouble(game, true);
  assert(game.doublingCube.owner === accepter, 'Accepted double should transfer cube ownership to accepter');
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
  runTest('Reject Doubling vs Doubling', testRejectDoublingVsDoubling);
  runTest('Foresight vs Foresight dice flow', testForesightVsForesightDiceFlow);
  runTest('Foresight vs Foresight cube uses standard ownership', testForesightVsForesightCubeIsStandard);
  runTest('Decline double uses prior cube value', testDeclineDoubleUsesPriorCubeValue);
  runTest('Pass when no legal moves', testPassWhenNoLegalMoves);
  console.log('All critical tests passed.');
}

if (require.main === module) {
  run();
}

export { run };
