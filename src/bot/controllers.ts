import {
  AsymmetricRoles,
  GameState,
  IPlayer,
  Move,
  Player,
  getSingleAsymmetricRolePlayer,
  playerHasAsymmetricRole
} from '../engine/types';
import { makeMove } from '../engine/game';
import {
  chooseHeuristicMove,
  chooseForesightMove,
  shouldAcceptDoubleWithPolicy,
  shouldOfferDoubleWithPolicy
} from './heuristics';

export interface PlannedMoveState {
  plannedMoves: Move[] | null;
  plannedBoard: GameState['board'] | null;
}

function sameMove(a: Move[], b: Move[]): boolean {
  return a.length === b.length &&
    a.every((move, idx) =>
      move.from === b[idx].from &&
      move.to === b[idx].to &&
      move.die === b[idx].die
    );
}

export function createAsymmetricBotController(
  botPlayer: Player,
  roles: AsymmetricRoles,
  plannedMoveState?: PlannedMoveState
): IPlayer {
  const stateCache: PlannedMoveState = plannedMoveState ?? {
    plannedMoves: null,
    plannedBoard: null
  };

  const isForesightBot = playerHasAsymmetricRole(roles, botPlayer, 'foresight');
  const isDoublingBot = playerHasAsymmetricRole(roles, botPlayer, 'doubling');
  const fixedDoublingPlayer = getSingleAsymmetricRolePlayer(roles, 'doubling');

  const clearPlannedMove = () => {
    stateCache.plannedMoves = null;
    stateCache.plannedBoard = null;
  };

  const chooseStrategicMove = (state: GameState, legalMoves: Move[][]): Move[] => {
    if (state.variant !== 'asymmetric') {
      if (legalMoves.length === 0) return [];
      return legalMoves[Math.floor(Math.random() * legalMoves.length)];
    }

    return isForesightBot
      ? chooseForesightMove(state, botPlayer)
      : chooseHeuristicMove(state, botPlayer);
  };

  const consumePlannedMove = (state: GameState, legalMoves: Move[][]): Move[] | null => {
    const plannedMoves = stateCache.plannedMoves;
    const plannedBoard = stateCache.plannedBoard;

    if (!plannedMoves) return null;
    if (state.currentPlayer !== botPlayer || state.phase !== 'moving' || plannedBoard !== state.board) {
      clearPlannedMove();
      return null;
    }

    const stillLegal = legalMoves.some((seq) => sameMove(seq, plannedMoves));
    if (!stillLegal) {
      clearPlannedMove();
      return null;
    }

    clearPlannedMove();
    return plannedMoves;
  };

  return {
    getMove: async (state, legalMoves) => {
      const planned = consumePlannedMove(state, legalMoves);
      if (planned) return planned;
      return chooseStrategicMove(state, legalMoves);
    },
    offerDouble: async (state) => {
      if (state.variant !== 'asymmetric') return false;
      if (state.currentPlayer !== botPlayer || state.phase !== 'moving') return false;
      if (fixedDoublingPlayer && !isDoublingBot) return false;
      if (!fixedDoublingPlayer && state.doublingCube.owner !== null && state.doublingCube.owner !== botPlayer) {
        return false;
      }

      const plannedMoves = chooseStrategicMove(state, []);
      stateCache.plannedMoves = plannedMoves;
      stateCache.plannedBoard = state.board;

      const projection = makeMove(state, plannedMoves);
      const evaluationState = projection.valid && projection.newState ? projection.newState : state;
      return shouldOfferDoubleWithPolicy(evaluationState, botPlayer);
    },
    acceptDouble: async (state) => shouldAcceptDoubleWithPolicy(state, botPlayer)
  };
}
