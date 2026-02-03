import { GameState, Move, Player } from './types';
import { MatchState } from './match';

export const STATE_VECTOR_LENGTH = 73;
export const MOVE_MAX = 4;
export const MOVE_FEATURE_DIM = MOVE_MAX * 3 + 1;

function normalizeCount(value: number, max: number): number {
  if (max <= 0) return 0;
  return value / max;
}

export function encodeState(state: GameState, match: MatchState, actor: Player): number[] {
  const features: number[] = [];

  // Board points (1-24): [whiteCount, blackCount]
  for (let point = 1; point <= 24; point += 1) {
    const stack = state.board[point];
    const whiteCount = stack && stack.player === 'white' ? stack.count : 0;
    const blackCount = stack && stack.player === 'black' ? stack.count : 0;
    features.push(normalizeCount(whiteCount, 15));
    features.push(normalizeCount(blackCount, 15));
  }

  // Bar counts
  const whiteBar = state.board[0]?.player === 'white' ? state.board[0]!.count : 0;
  const blackBar = state.board[25]?.player === 'black' ? state.board[25]!.count : 0;
  features.push(normalizeCount(whiteBar, 15));
  features.push(normalizeCount(blackBar, 15));

  // Off counts
  features.push(normalizeCount(state.whiteOff, 15));
  features.push(normalizeCount(state.blackOff, 15));

  // Actor + current player
  features.push(actor === 'white' ? 1 : 0);
  features.push(state.currentPlayer === 'white' ? 1 : 0);

  // Phase one-hot
  features.push(state.phase === 'rolling' ? 1 : 0);
  features.push(state.phase === 'moving' ? 1 : 0);
  features.push(state.phase === 'gameOver' ? 1 : 0);

  // Doubling cube
  const cubeValue = Math.max(1, state.doublingCube.value);
  const cubeLog = Math.log2(cubeValue) / 6;
  features.push(cubeLog);
  features.push(state.doublingCube.owner === 'white' ? 1 : 0);
  features.push(state.doublingCube.owner === 'black' ? 1 : 0);
  features.push(state.doublingCube.owner === null ? 1 : 0);
  features.push(state.doubleOfferedThisTurn ? 1 : 0);

  // Match score as points away from target
  const isLimited = match.config.type === 'limited' && typeof match.config.targetScore === 'number';
  const targetScore = isLimited ? match.config.targetScore! : 0;
  const pointsAwayWhite = isLimited ? Math.max(0, targetScore - match.score.white) : 0;
  const pointsAwayBlack = isLimited ? Math.max(0, targetScore - match.score.black) : 0;
  features.push(pointsAwayWhite);
  features.push(pointsAwayBlack);
  features.push(isLimited ? 1 : 0);
  features.push(match.crawfordGame ? 1 : 0);
  features.push(match.postCrawford ? 1 : 0);

  // Asymmetric metadata
  const isAsymmetric = state.variant === 'asymmetric';
  features.push(isAsymmetric ? 1 : 0);
  features.push(state.asymmetricRoles?.foresightPlayer === 'white' ? 1 : 0);
  features.push(state.asymmetricRoles?.doublingPlayer === 'white' ? 1 : 0);
  features.push(state.asymmetricRoles?.foresightPlayer === actor ? 1 : 0);
  features.push(state.asymmetricRoles?.doublingPlayer === actor ? 1 : 0);
  const opponentDiceKnown = Boolean(
    isAsymmetric &&
    state.asymmetricRoles?.foresightPlayer === actor &&
    state.whiteDice &&
    state.blackDice
  );
  features.push(opponentDiceKnown ? 1 : 0);

  return features;
}

export function serializeMoveSequence(moves: Move[]): string {
  return moves.map((move) => `${move.from}:${move.to}:${move.die}`).join('|');
}

export function serializeLegalMoves(legalMoves: Move[][]): string[] {
  return legalMoves.map(serializeMoveSequence);
}

function normalizePoint(value: number): number {
  if (value < 0) return 0;
  return value / 25;
}

export function encodeMoveSequence(moves: Move[]): number[] {
  const features: number[] = [];
  const limited = moves.slice(0, MOVE_MAX);
  for (const move of limited) {
    features.push(normalizePoint(move.from));
    features.push(normalizePoint(move.to));
    features.push(move.die / 6);
  }
  while (features.length < MOVE_MAX * 3) {
    features.push(0, 0, 0);
  }
  features.push(moves.length / MOVE_MAX);
  return features;
}

export function encodeMoveSequences(legalMoves: Move[][]): number[][] {
  return legalMoves.map(encodeMoveSequence);
}
