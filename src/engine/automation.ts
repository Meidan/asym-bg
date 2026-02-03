import { GameState, IPlayer, Move, Player } from './types';
import { getOpponent } from './board';
import { getLegalMoves } from './moves';
import { createGame, makeMove, offerDouble, respondToDouble, rollForFirst, rollTurn } from './game';
import { MatchState, canOfferDoubleNow, updateMatchScore } from './match';

export interface AutomationPlayers {
  white?: IPlayer;
  black?: IPlayer;
}

export interface AutomationStepResult {
  state: GameState;
  pendingDoubleOfferer: Player | null;
  advanced: boolean;
  awaitingInput: boolean;
}

export interface AutomationOptions {
  maxSteps?: number;
}

function isAutomated(players: AutomationPlayers, player: Player): players is AutomationPlayers {
  return Boolean(players[player]);
}

function computeAwaitingInput(
  state: GameState,
  pendingDoubleOfferer: Player | null,
  players: AutomationPlayers
): boolean {
  if (pendingDoubleOfferer) {
    const responder = getOpponent(pendingDoubleOfferer);
    return !isAutomated(players, responder);
  }
  return !isAutomated(players, state.currentPlayer);
}

export async function stepAutomatedTurn(
  match: MatchState,
  state: GameState,
  pendingDoubleOfferer: Player | null,
  players: AutomationPlayers
): Promise<AutomationStepResult> {
  if (state.winner) {
    return { state, pendingDoubleOfferer, advanced: false, awaitingInput: false };
  }

  if (pendingDoubleOfferer) {
    const responder = getOpponent(pendingDoubleOfferer);
    const controller = players[responder];
    if (!controller) {
      return { state, pendingDoubleOfferer, advanced: false, awaitingInput: true };
    }
    const accepted = controller.acceptDouble ? await controller.acceptDouble(state) : true;
    const nextState = respondToDouble(state, accepted);
    const nextPending = null;
    return {
      state: nextState,
      pendingDoubleOfferer: nextPending,
      advanced: true,
      awaitingInput: computeAwaitingInput(nextState, nextPending, players)
    };
  }

  const currentPlayer = state.currentPlayer;
  const controller = players[currentPlayer];
  if (!controller) {
    return { state, pendingDoubleOfferer, advanced: false, awaitingInput: true };
  }

  if (controller.offerDouble && canOfferDoubleNow(match, state, currentPlayer)) {
    const wantsDouble = await controller.offerDouble(state);
    if (wantsDouble) {
      const nextState = offerDouble(state);
      const nextPending = currentPlayer;
      return {
        state: nextState,
        pendingDoubleOfferer: nextPending,
        advanced: true,
        awaitingInput: computeAwaitingInput(nextState, nextPending, players)
      };
    }
  }

  if (state.phase === 'rolling') {
    const nextState = rollTurn(state);
    return {
      state: nextState,
      pendingDoubleOfferer,
      advanced: true,
      awaitingInput: computeAwaitingInput(nextState, pendingDoubleOfferer, players)
    };
  }

  if (state.phase === 'moving') {
    const legalMoves = getLegalMoves(state);
    let moves: Move[] = [];
    if (legalMoves.length === 0) {
      moves = [];
    } else {
      moves = await controller.getMove(state, legalMoves);
    }

    let result = makeMove(state, moves);
    if (!result.valid || !result.newState) {
      if (legalMoves.length > 0) {
        result = makeMove(state, legalMoves[0]);
      }
      if (!result.valid || !result.newState) {
        throw new Error('Automated move failed');
      }
    }

    const nextState = result.newState;
    return {
      state: nextState,
      pendingDoubleOfferer,
      advanced: true,
      awaitingInput: computeAwaitingInput(nextState, pendingDoubleOfferer, players)
    };
  }

  return { state, pendingDoubleOfferer, advanced: false, awaitingInput: false };
}

export async function runAutomatedGame(
  match: MatchState,
  players: AutomationPlayers,
  options?: AutomationOptions
): Promise<{ state: GameState }> {
  let state = rollForFirst(createGame({
    variant: match.config.variant,
    asymmetricRoles: match.asymmetricRoles
  }));
  let pendingDoubleOfferer: Player | null = null;
  let steps = 0;
  const maxSteps = options?.maxSteps ?? 100000;

  while (!state.winner) {
    if (steps > maxSteps) {
      throw new Error('Automated game exceeded step limit');
    }
    const result = await stepAutomatedTurn(match, state, pendingDoubleOfferer, players);
    if (!result.advanced) {
      throw new Error('Automated game requires human input');
    }
    state = result.state;
    pendingDoubleOfferer = result.pendingDoubleOfferer;
    steps += 1;
  }

  return { state };
}

export async function runAutomatedMatch(
  match: MatchState,
  players: AutomationPlayers,
  options?: AutomationOptions
): Promise<MatchState> {
  let currentMatch = match;
  while (!currentMatch.winner) {
    const { state } = await runAutomatedGame(currentMatch, players, options);
    if (!state.winner) {
      throw new Error('Automated game ended without a winner');
    }
    const points = state.pointsAwarded || 1;
    currentMatch = updateMatchScore(currentMatch, state.winner, points);
  }
  return currentMatch;
}
