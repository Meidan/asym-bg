import { GameState, Move, Player, IPlayer } from '../engine/types';
import { getOpponent, allCheckersInHomeBoard } from '../engine/board';
import { getLegalMoves } from '../engine/moves';
import { makeMove } from '../engine/game';
import { evaluateStateWithGnubg, GnuBgEquityType, evaluateStateWithGnubgDouble } from './gnubg';

export const DEFAULT_MAX_CANDIDATES = 30;
export const DEFAULT_MAX_REPLY_CANDIDATES = 30;

export type HeuristicPolicy = 'simple' | 'gnubg';

export interface HeuristicEvalOptions {
  policy?: HeuristicPolicy;
  equity?: GnuBgEquityType;
  gnubgTimeoutMs?: number;
}

export interface HeuristicMoveOptions extends HeuristicEvalOptions {
  maxCandidates?: number;
}

export interface HeuristicForesightOptions extends HeuristicEvalOptions {
  maxCandidates?: number;
  maxReplyCandidates?: number;
}

export interface HeuristicControllerOptions extends HeuristicEvalOptions {
  role: 'foresight' | 'doubling';
  maxCandidates?: number;
  maxReplyCandidates?: number;
}

const DEFAULT_HEURISTIC_POLICY: HeuristicPolicy = 'gnubg';
const DEFAULT_GNUBG_EQUITY_FOR_HEURISTIC: GnuBgEquityType = 'cubeful';
const DEFAULT_GNUBG_EQUITY_FOR_FORESIGHT: GnuBgEquityType = 'cubeless';
const GNUBG_OFFER_DOUBLE_THRESHOLD = 0.5;
const GNUBG_ACCEPT_DOUBLE_THRESHOLD = -0.5;

let gnubgFailureLogged = false;
let gnubgUnavailable = false;

function isGnubgMissing(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT'
  );
}

function logGnubgFailure(error: unknown): void {
  if (gnubgFailureLogged) return;
  gnubgFailureLogged = true;
  const message = error instanceof Error ? error.message : String(error ?? '');
  console.warn(`Gnubg evaluation failed; falling back to simple heuristic. ${message}`);
}

async function evaluateStateWithPolicy(
  state: GameState,
  player: Player,
  options: HeuristicEvalOptions | undefined,
  defaultEquity: GnuBgEquityType
): Promise<number> {
  const policy = options?.policy ?? DEFAULT_HEURISTIC_POLICY;
  if (policy !== 'gnubg' || gnubgUnavailable) {
    return evaluateState(state, player);
  }

  const equity = options?.equity ?? defaultEquity;
  try {
    return await evaluateStateWithGnubg({
      state,
      perspective: player,
      equity,
      timeoutMs: options?.gnubgTimeoutMs
    });
  } catch (error) {
    if (isGnubgMissing(error)) gnubgUnavailable = true;
    logGnubgFailure(error);
    return evaluateState(state, player);
  }
}

async function evaluateGnubgOrNull(
  state: GameState,
  player: Player,
  equity: GnuBgEquityType,
  options: HeuristicEvalOptions | undefined
): Promise<number | null> {
  if (gnubgUnavailable) return null;
  try {
    return await evaluateStateWithGnubg({
      state,
      perspective: player,
      equity,
      timeoutMs: options?.gnubgTimeoutMs
    });
  } catch (error) {
    if (isGnubgMissing(error)) gnubgUnavailable = true;
    logGnubgFailure(error);
    return null;
  }
}

function countPips(board: GameState['board'], player: Player): number {
  let total = 0;
  const barPoint = player === 'white' ? 0 : 25;
  const barStack = board[barPoint];
  if (barStack && barStack.player === player) {
    total += barStack.count * 25;
  }
  for (let point = 1; point <= 24; point += 1) {
    const stack = board[point];
    if (!stack || stack.player !== player) continue;
    const distance = player === 'white' ? point : (25 - point);
    total += distance * stack.count;
  }
  return total;
}

function getBarCount(board: GameState['board'], player: Player): number {
  const barPoint = player === 'white' ? 0 : 25;
  const stack = board[barPoint];
  if (!stack || stack.player !== player) return 0;
  return stack.count;
}

function countMadePoints(board: GameState['board'], player: Player, start: number, end: number): number {
  let count = 0;
  for (let point = start; point <= end; point += 1) {
    const stack = board[point];
    if (stack && stack.player === player && stack.count >= 2) {
      count += 1;
    }
  }
  return count;
}

function maxPrimeLength(board: GameState['board'], player: Player): number {
  let max = 0;
  let current = 0;
  for (let point = 1; point <= 24; point += 1) {
    const stack = board[point];
    if (stack && stack.player === player && stack.count >= 2) {
      current += 1;
      if (current > max) max = current;
    } else {
      current = 0;
    }
  }
  return max;
}

function listBlots(board: GameState['board'], player: Player): number[] {
  const blots: number[] = [];
  for (let point = 1; point <= 24; point += 1) {
    const stack = board[point];
    if (stack && stack.player === player && stack.count === 1) {
      blots.push(point);
    }
  }
  return blots;
}

function isBlotHittable(board: GameState['board'], player: Player, blotPoint: number): boolean {
  const opponent = getOpponent(player);
  if (player === 'white') {
    for (let die = 1; die <= 6; die += 1) {
      const from = blotPoint - die;
      if (from < 1) break;
      const stack = board[from];
      if (stack && stack.player === opponent) return true;
    }
  } else {
    for (let die = 1; die <= 6; die += 1) {
      const from = blotPoint + die;
      if (from > 24) break;
      const stack = board[from];
      if (stack && stack.player === opponent) return true;
    }
  }

  const opponentBar = opponent === 'white' ? 0 : 25;
  const barStack = board[opponentBar];
  if (barStack && barStack.player === opponent && barStack.count > 0) {
    if (opponent === 'white' && blotPoint >= 19 && blotPoint <= 24) return true;
    if (opponent === 'black' && blotPoint >= 1 && blotPoint <= 6) return true;
  }

  return false;
}

function isRacePosition(board: GameState['board']): boolean {
  return allCheckersInHomeBoard(board, 'white') && allCheckersInHomeBoard(board, 'black');
}

export function evaluateState(state: GameState, player: Player): number {
  const opponent = getOpponent(player);
  const board = state.board;

  const pipDiff = countPips(board, opponent) - countPips(board, player);
  const blots = listBlots(board, player);
  const exposed = blots.filter(point => isBlotHittable(board, player, point)).length;
  const loose = blots.length - exposed;

  const prime = maxPrimeLength(board, player);
  const homePoints = countMadePoints(board, player, player === 'white' ? 1 : 19, player === 'white' ? 6 : 24);
  const anchors = countMadePoints(board, player, opponent === 'white' ? 1 : 19, opponent === 'white' ? 6 : 24);
  const opponentOnBar = getBarCount(board, opponent);
  const ourOnBar = getBarCount(board, player);
  const race = isRacePosition(board);

  const pipWeight = race ? 1.3 : 1.0;
  const exposedWeight = race ? 3.0 : 8.0;
  const looseWeight = race ? 1.0 : 3.0;

  let score = 0;
  score += pipWeight * pipDiff;
  score -= exposedWeight * exposed;
  score -= looseWeight * loose;
  score += 6.0 * Math.min(prime, 6);
  score += 5.0 * homePoints;
  score += 4.0 * anchors;
  score += 10.0 * opponentOnBar;
  score -= 6.0 * ourOnBar;

  return score;
}

function sampleMoves(sequences: Move[][], limit: number): Move[][] {
  if (sequences.length <= limit) return sequences;
  const picked: Move[][] = [];
  const used = new Set<number>();
  while (picked.length < limit && used.size < sequences.length) {
    const idx = Math.floor(Math.random() * sequences.length);
    if (used.has(idx)) continue;
    used.add(idx);
    picked.push(sequences[idx]);
  }
  return picked;
}

export async function chooseHeuristicMove(
  state: GameState,
  player: Player,
  options?: HeuristicMoveOptions
): Promise<Move[]> {
  const legalMoves = getLegalMoves(state);
  if (legalMoves.length === 0) return [];

  const maxCandidates = options?.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  const candidates = sampleMoves(legalMoves, maxCandidates);

  let bestScore = -Infinity;
  let bestMoves: Move[][] = [];

  for (const seq of candidates) {
    const result = makeMove(state, seq);
    if (!result.valid || !result.newState) continue;
    const score = await evaluateStateWithPolicy(
      result.newState,
      player,
      options,
      DEFAULT_GNUBG_EQUITY_FOR_HEURISTIC
    );
    if (score > bestScore) {
      bestScore = score;
      bestMoves = [seq];
    } else if (score === bestScore) {
      bestMoves.push(seq);
    }
  }

  return bestMoves[Math.floor(Math.random() * bestMoves.length)] || legalMoves[0];
}

export async function chooseForesightMove(
  state: GameState,
  player: Player,
  options?: HeuristicForesightOptions
): Promise<Move[]> {
  const legalMoves = getLegalMoves(state);
  if (legalMoves.length === 0) return [];

  const maxCandidates = options?.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  const maxReplyCandidates = options?.maxReplyCandidates ?? DEFAULT_MAX_REPLY_CANDIDATES;
  const candidates = sampleMoves(legalMoves, maxCandidates);

  let bestScore = -Infinity;
  let bestMoves: Move[][] = [];

  for (const seq of candidates) {
    const result = makeMove(state, seq);
    if (!result.valid || !result.newState) continue;

    const afterBot = result.newState;
    let score = await evaluateStateWithPolicy(
      afterBot,
      player,
      options,
      DEFAULT_GNUBG_EQUITY_FOR_FORESIGHT
    );

    if (afterBot.phase === 'moving' && !afterBot.winner) {
      const replyMoves = getLegalMoves(afterBot);
      if (replyMoves.length === 0) {
        score += 10;
      } else {
        let worst = Infinity;
        const replyCandidates = sampleMoves(replyMoves, maxReplyCandidates);
        for (const reply of replyCandidates) {
          const replyResult = makeMove(afterBot, reply);
          if (!replyResult.valid || !replyResult.newState) continue;
          const replyScore = await evaluateStateWithPolicy(
            replyResult.newState,
            player,
            options,
            DEFAULT_GNUBG_EQUITY_FOR_FORESIGHT
          );
          if (replyScore < worst) worst = replyScore;
        }
        if (worst !== Infinity) score = worst;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMoves = [seq];
    } else if (score === bestScore) {
      bestMoves.push(seq);
    }
  }

  return bestMoves[Math.floor(Math.random() * bestMoves.length)] || legalMoves[0];
}

export function shouldOfferDouble(state: GameState, player: Player): boolean {
  const board = state.board;
  const opponent = getOpponent(player);
  const pipDiff = countPips(board, opponent) - countPips(board, player);
  const race = isRacePosition(board);
  const opponentOnBar = getBarCount(board, opponent);
  const homePoints = countMadePoints(board, player, player === 'white' ? 1 : 19, player === 'white' ? 6 : 24);
  const prime = maxPrimeLength(board, player);
  const score = evaluateState(state, player);

  if (race && pipDiff > 20) return true;
  if (opponentOnBar >= 2 && homePoints >= 3) return true;
  if (prime >= 4 && opponentOnBar > 0) return true;
  return score > 24;
}

export function shouldAcceptDouble(state: GameState, player: Player): boolean {
  const board = state.board;
  const opponent = getOpponent(player);
  const pipDiff = countPips(board, opponent) - countPips(board, player);
  const race = isRacePosition(board);
  const ourBar = getBarCount(board, player);
  const opponentPrime = maxPrimeLength(board, opponent);
  const opponentHome = countMadePoints(board, opponent, opponent === 'white' ? 1 : 19, opponent === 'white' ? 6 : 24);
  const score = evaluateState(state, player);

  if (race && pipDiff < -20) return false;
  if (!race && pipDiff < -16) return false;
  if (!race && ourBar > 0 && opponentPrime >= 4 && opponentHome >= 3) return false;
  if (!race && opponentPrime >= 5 && opponentHome >= 4 && pipDiff < -10) return false;
  return score >= -10;
}

export async function shouldOfferDoubleWithPolicy(
  state: GameState,
  player: Player,
  options?: HeuristicEvalOptions
): Promise<boolean> {
  const policy = options?.policy ?? DEFAULT_HEURISTIC_POLICY;
  if (policy !== 'gnubg') return shouldOfferDouble(state, player);
  const equityType = options?.equity ?? DEFAULT_GNUBG_EQUITY_FOR_HEURISTIC;
  try {
    const decision = await evaluateStateWithGnubgDouble({ state, perspective: player, equity: equityType, timeoutMs: options?.gnubgTimeoutMs });
    if (typeof decision.offer === 'boolean') return decision.offer;
    console.warn('Gnubg did not return explicit double offer decision; falling back to equity threshold', state.doublingCube, player);
    // fallback to equity-based decision when gnubg output didn't include explicit decision
    if (typeof decision.equity === 'number') return decision.equity >= GNUBG_OFFER_DOUBLE_THRESHOLD;
    return shouldOfferDouble(state, player);
  } catch (err) {
    return shouldOfferDouble(state, player);
  }
}

export async function shouldAcceptDoubleWithPolicy(
  state: GameState,
  player: Player,
  options?: HeuristicEvalOptions
): Promise<boolean> {
  const policy = options?.policy ?? DEFAULT_HEURISTIC_POLICY;
  if (policy !== 'gnubg') return shouldAcceptDouble(state, player);
  const equityType = options?.equity ?? DEFAULT_GNUBG_EQUITY_FOR_HEURISTIC;
  try {
    const decision = await evaluateStateWithGnubgDouble({ state, perspective: player, equity: equityType, timeoutMs: options?.gnubgTimeoutMs });
    if (typeof decision.accept === 'boolean') return decision.accept;
    await evaluateStateWithGnubgDouble({ state, perspective: player, equity: equityType, timeoutMs: options?.gnubgTimeoutMs }, true);
    console.warn('Gnubg did not return explicit double accept decision; falling back to equity threshold', state.doublingCube, player);
    if (typeof decision.equity === 'number') return decision.equity >= GNUBG_ACCEPT_DOUBLE_THRESHOLD;
    return shouldAcceptDouble(state, player);
  } catch (err) {
    return shouldAcceptDouble(state, player);
  }
}

export function createHeuristicController(options: HeuristicControllerOptions): IPlayer {
  const policy = options.policy ?? DEFAULT_HEURISTIC_POLICY;
  console.log(`Creating heuristic controller with policy: ${policy}`);
  const moveEquity = options.equity ?? (options.role === 'foresight'
    ? DEFAULT_GNUBG_EQUITY_FOR_FORESIGHT
    : DEFAULT_GNUBG_EQUITY_FOR_HEURISTIC);

  const moveOptions: HeuristicForesightOptions = {
    policy,
    equity: moveEquity,
    gnubgTimeoutMs: options.gnubgTimeoutMs,
    maxCandidates: options.maxCandidates,
    maxReplyCandidates: options.maxReplyCandidates
  };

  return {
    getMove: async (state) => {
      if (options.role === 'foresight') {
        return chooseForesightMove(state, state.currentPlayer, moveOptions);
      }
      return chooseHeuristicMove(state, state.currentPlayer, moveOptions);
    },
    offerDouble: async (state) => shouldOfferDoubleWithPolicy(state, state.currentPlayer, {
      policy,
      equity: DEFAULT_GNUBG_EQUITY_FOR_HEURISTIC,
      gnubgTimeoutMs: options.gnubgTimeoutMs
    }),
    acceptDouble: async (state) => shouldAcceptDoubleWithPolicy(state, state.currentPlayer, {
      policy,
      equity: DEFAULT_GNUBG_EQUITY_FOR_HEURISTIC,
      gnubgTimeoutMs: options.gnubgTimeoutMs
    })
  };
}
