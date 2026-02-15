/**
 * Main game engine - handles game flow and state transitions
 */

import {
  GameState,
  GameConfig,
  Player,
  Dice,
  Move,
  MoveResult,
  Turn,
  AsymmetricRoles,
  getDiceValues,
  getSingleAsymmetricRolePlayer,
  isValidAsymmetricRoles,
  normalizeAsymmetricRoles,
  playerHasAsymmetricRole,
  randomAsymmetricRoles
} from './types';
import {
  createInitialBoard,
  getOpponent,
  countCheckersOnBoard,
  hasCheckersOnBar
} from './board';
import {
  getLegalMoves,
  validateAndApplyMoves,
  hasLegalMoves
} from './moves';

/**
 * Create a new game
 */
export function createGame(config: GameConfig): GameState {
  const state: GameState = {
    variant: config.variant,
    board: createInitialBoard(),
    currentPlayer: 'white', // Will be determined by initial roll
    phase: 'setup',
    whiteDice: null,
    blackDice: null,
    unusedDice: [],
    doublingCube: {
      value: 1,
      owner: null // Centered initially
    },
    stakes: 1,
    doubleOfferedThisTurn: false,
    whiteOff: 0,
    blackOff: 0,
    moveHistory: [],
    winner: null
  };
  
  // Setup asymmetric variant roles if needed
  if (config.variant === 'asymmetric') {
    const roles = normalizeAsymmetricRoles(config.asymmetricRoles);
    state.asymmetricRoles = roles;
    if (roles) {
      if (!isValidAsymmetricRoles(roles)) {
        throw new Error('Invalid asymmetric roles: Doubling vs Doubling is not allowed');
      }
      state.doublingCube.owner = getAsymmetricCubeOwner(roles);
    } else {
      state.doublingCube.owner = null;
    }
  }
  
  return state;
}

/**
 * Roll dice for initial turn determination
 */
export function rollForFirst(state: GameState): GameState {
  if (state.phase !== 'setup') {
    throw new Error('Can only roll for first in setup phase');
  }

  if (state.variant === 'asymmetric') {
    const roles = state.asymmetricRoles || randomAsymmetricRoles();
    if (!isValidAsymmetricRoles(roles)) {
      throw new Error('Invalid asymmetric roles: Doubling vs Doubling is not allowed');
    }
    const singleForesightPlayer = getSingleAsymmetricRolePlayer(roles, 'foresight');
    const firstPlayer = singleForesightPlayer || (Math.random() < 0.5 ? 'white' : 'black');

    return {
      ...state,
      currentPlayer: firstPlayer,
      phase: 'rolling',
      whiteDice: null,
      blackDice: null,
      asymmetricRoles: roles,
      doublingCube: {
        ...state.doublingCube,
        owner: getAsymmetricCubeOwner(roles)
      }
    };
  }

  const whiteDie = rollDie();
  const blackDie = rollDie();
  
  // Re-roll if tied
  if (whiteDie === blackDie) {
    return rollForFirst(state);
  }
  
  const firstPlayer: Player = whiteDie > blackDie ? 'white' : 'black';
  
  const newState: GameState = {
    ...state,
    currentPlayer: firstPlayer,
    phase: 'rolling',
    whiteDice: { die1: whiteDie, die2: whiteDie },
    blackDice: { die1: blackDie, die2: blackDie }
  };
  
  return newState;
}

/**
 * Roll a single die (1-6)
 */
export function rollDie(): number {
  return Math.floor(Math.random() * 6) + 1;
}

/**
 * Roll both dice
 */
export function rollDice(): Dice {
  return {
    die1: rollDie(),
    die2: rollDie()
  };
}

function rollDiceNoDoubles(): Dice {
  let dice = rollDice();
  while (dice.die1 === dice.die2) {
    dice = rollDice();
  }
  return dice;
}

function getAsymmetricCubeOwner(roles: AsymmetricRoles | undefined): Player | null {
  if (!roles) return null;
  return getSingleAsymmetricRolePlayer(roles, 'doubling');
}

/**
 * Start a turn by rolling dice
 */
export function rollTurn(state: GameState): GameState {
  if (state.phase !== 'rolling') {
    throw new Error('Can only roll dice in rolling phase');
  }
  
  const openingTurn = state.moveHistory.length === 0;

  if (state.variant === 'asymmetric' && state.asymmetricRoles) {
    const roles = state.asymmetricRoles;
    const currentPlayer = state.currentPlayer;
    const opponent = getOpponent(currentPlayer);
    const currentDice = openingTurn ? rollDiceNoDoubles() : rollDice();
    const currentIsForesight = playerHasAsymmetricRole(roles, currentPlayer, 'foresight');
    const opponentIsForesight = playerHasAsymmetricRole(roles, opponent, 'foresight');

    if (currentIsForesight) {
      const existingOpponentDice = opponent === 'white' ? state.whiteDice : state.blackDice;
      const shouldRollOpponentDiceNow = !opponentIsForesight || openingTurn || !existingOpponentDice;
      const opponentDice = shouldRollOpponentDiceNow ? rollDice() : existingOpponentDice;

      return {
        ...state,
        whiteDice: currentPlayer === 'white'
          ? currentDice
          : opponentDice,
        blackDice: currentPlayer === 'black'
          ? currentDice
          : opponentDice,
        unusedDice: getDiceValues(currentDice),
        phase: 'moving'
      };
    }

    return {
      ...state,
      whiteDice: currentPlayer === 'white' ? currentDice : state.whiteDice,
      blackDice: currentPlayer === 'black' ? currentDice : state.blackDice,
      unusedDice: getDiceValues(currentDice),
      phase: 'moving'
    };
  } else {
    // Standard variant: each player rolls their own dice
    const dice = openingTurn ? rollDiceNoDoubles() : rollDice();
    
    return {
      ...state,
      whiteDice: state.currentPlayer === 'white' ? dice : state.whiteDice,
      blackDice: state.currentPlayer === 'black' ? dice : state.blackDice,
      unusedDice: getDiceValues(dice),
      phase: 'moving'
    };
  }
}

/**
 * Make moves for the current turn
 */
export function makeMove(state: GameState, moves: Move[]): MoveResult {
  const result = validateAndApplyMoves(state, moves);
  
  if (!result.valid || !result.newState) {
    return result;
  }
  
  // Check if all dice are used or no more moves possible
  const allDiceUsed = result.newState.unusedDice.length === 0;
  const hasMoreMoves = hasLegalMoves(result.newState);
  
  if (allDiceUsed || !hasMoreMoves) {
    // Turn is complete
    const dice = state.currentPlayer === 'white' ? state.whiteDice : state.blackDice;
    
    // Record turn in history
    const turn: Turn = {
      player: state.currentPlayer,
      dice: dice!,
      moves: moves
    };
    
    result.newState.moveHistory.push(turn);
    
    // Check for winner
    const winner = checkWinner(result.newState);
    if (winner) {
      result.newState.winner = winner.player;
      result.newState.winType = winner.type;
      result.newState.phase = 'gameOver';
      
      // Calculate points awarded: cube value × win type multiplier
      const cubeValue = result.newState.doublingCube.value;
      const winTypeMultiplier = winner.type === 'normal' ? 1 : 
                                 winner.type === 'gammon' ? 2 : 3; // backgammon
      result.newState.pointsAwarded = cubeValue * winTypeMultiplier;
    } else {
      // Switch to next player
      const nextPlayer = getOpponent(state.currentPlayer);
      result.newState.currentPlayer = nextPlayer;
      
      if (state.variant === 'asymmetric' && state.asymmetricRoles) {
        const roles = state.asymmetricRoles;
        const movedPlayer = state.currentPlayer;
        const movedPlayerIsForesight = playerHasAsymmetricRole(roles, movedPlayer, 'foresight');
        const nextPlayerIsForesight = playerHasAsymmetricRole(roles, nextPlayer, 'foresight');

        // Clear the dice consumed by the player who just moved.
        if (movedPlayer === 'white') {
          result.newState.whiteDice = null;
        } else {
          result.newState.blackDice = null;
        }

        // Foresight vs Foresight:
        // keep both players' next dice visible each turn.
        if (movedPlayerIsForesight && nextPlayerIsForesight) {
          const nextPlayerDice = nextPlayer === 'white' ? result.newState.whiteDice : result.newState.blackDice;
          if (!nextPlayerDice) {
            const rolledForNextPlayer = rollDice();
            if (nextPlayer === 'white') {
              result.newState.whiteDice = rolledForNextPlayer;
            } else {
              result.newState.blackDice = rolledForNextPlayer;
            }
          }

          const movedPlayerNextDice = movedPlayer === 'white' ? result.newState.whiteDice : result.newState.blackDice;
          if (!movedPlayerNextDice) {
            const rolledForMovedPlayer = rollDice();
            if (movedPlayer === 'white') {
              result.newState.whiteDice = rolledForMovedPlayer;
            } else {
              result.newState.blackDice = rolledForMovedPlayer;
            }
          }
        }

        const nextDice = nextPlayer === 'white' ? result.newState.whiteDice : result.newState.blackDice;
        if (nextDice) {
          result.newState.phase = 'moving';
          result.newState.unusedDice = getDiceValues(nextDice);
        } else {
          result.newState.phase = 'rolling';
          result.newState.unusedDice = [];
          result.newState.whiteDice = null;
          result.newState.blackDice = null;
        }
      } else {
        // Standard variant: opponent needs to roll
        result.newState.phase = 'rolling';
        result.newState.unusedDice = [];
        result.newState.whiteDice = null;
        result.newState.blackDice = null;
      }
      result.newState.doubleOfferedThisTurn = false; // Reset when switching players
    }
  }
  
  return result;
}

/**
 * Offer to double the stakes
 */
export function offerDouble(state: GameState): GameState {
  // In asymmetric variant, doubling player can double at the start of moving phase
  // In standard variant, can only double in rolling phase
  const validPhase = state.variant === 'asymmetric' 
    ? (state.phase === 'rolling' || state.phase === 'moving')
    : state.phase === 'rolling';
    
  if (!validPhase) {
    throw new Error('Can only double at the start of your turn');
  }
  
  const cube = state.doublingCube;
  
  // Check if current player can double
  if (state.variant === 'asymmetric' && state.asymmetricRoles) {
    const fixedDoublingPlayer = getSingleAsymmetricRolePlayer(state.asymmetricRoles, 'doubling');

    // Foresight vs Doubling keeps fixed cube owner.
    if (fixedDoublingPlayer) {
      if (state.currentPlayer !== fixedDoublingPlayer) {
        throw new Error('Only doubling player can double in asymmetric variant');
      }
    } else {
      // Foresight vs Foresight uses standard ownership checks.
      if (cube.owner !== null && cube.owner !== state.currentPlayer) {
        throw new Error('You do not own the doubling cube');
      }
    }
    if (state.doubleOfferedThisTurn) {
      throw new Error('Can only offer double once per turn');
    }
  } else {
    // Standard rules: can only double if you own the cube or it's centered
    if (cube.owner !== null && cube.owner !== state.currentPlayer) {
      throw new Error('You do not own the doubling cube');
    }
  }
  
  if (cube.value >= 64) {
    throw new Error('Cube is already at maximum value');
  }

  return {
    ...state,
    doublingCube: {
      value: cube.value * 2,
      owner: cube.owner // In asymmetric, owner never changes
    },
    doubleOfferedThisTurn: state.variant === 'asymmetric' ? true : false
  };
}

/**
 * Accept or decline a double
 */
export function respondToDouble(state: GameState, accept: boolean): GameState {
  if (!accept) {
    // Declining - the offerer (current player) wins at prior cube value
    const priorCubeValue = Math.max(1, Math.floor(state.doublingCube.value / 2));
    return {
      ...state,
      winner: state.currentPlayer,
      winType: 'normal',
      phase: 'gameOver',
      pointsAwarded: priorCubeValue // Offerer wins at cube value before doubling
    };
  }
  
  // Accepting - continue with doubled stakes
  if (state.variant === 'asymmetric' && state.asymmetricRoles) {
    const fixedDoublingPlayer = getSingleAsymmetricRolePlayer(state.asymmetricRoles, 'doubling');
    if (!fixedDoublingPlayer) {
      // Foresight vs Foresight: standard transfer to accepter.
      return {
        ...state,
        stakes: state.doublingCube.value,
        doublingCube: {
          ...state.doublingCube,
          owner: getOpponent(state.currentPlayer)
        }
      };
    }

    return {
      ...state,
      stakes: state.doublingCube.value,
      doublingCube: {
        ...state.doublingCube,
        owner: getAsymmetricCubeOwner(state.asymmetricRoles)
      }
    };
  }

  return {
    ...state,
    stakes: state.doublingCube.value,
    doublingCube: {
      ...state.doublingCube,
      owner: getOpponent(state.currentPlayer)
    }
  };
}

/**
 * Check if game is over and return winner
 */
function checkWinner(state: GameState): { player: Player; type: 'normal' | 'gammon' | 'backgammon' } | null {
  // Check if either player has borne off all 15 checkers
  if (state.whiteOff === 15) {
    return {
      player: 'white',
      type: determineWinType(state, 'white')
    };
  }
  
  if (state.blackOff === 15) {
    return {
      player: 'black',
      type: determineWinType(state, 'black')
    };
  }
  
  return null;
}

/**
 * Determine the type of win (normal, gammon, backgammon)
 */
function determineWinType(state: GameState, winner: Player): 'normal' | 'gammon' | 'backgammon' {
  const loser = getOpponent(winner);
  const loserOff = loser === 'white' ? state.whiteOff : state.blackOff;
  
  // Normal win - opponent has borne off at least one checker
  if (loserOff > 0) {
    return 'normal';
  }
  
  // Check for backgammon - opponent has checkers in winner's home board or on bar
  const [homeStart, homeEnd] = winner === 'white' ? [1, 6] : [19, 24];
  
  if (hasCheckersOnBar(state.board, loser)) {
    return 'backgammon';
  }
  
  for (let point = homeStart; point <= homeEnd; point++) {
    const stack = state.board[point];
    if (stack && stack.player === loser && stack.count > 0) {
      return 'backgammon';
    }
  }
  
  // Gammon - opponent hasn't borne off any checkers
  return 'gammon';
}

/**
 * Get current game score based on win type and cube value
 */
export function calculateScore(state: GameState): number {
  if (!state.winner || !state.winType) return 0;
  
  const baseScore = state.stakes;
  
  switch (state.winType) {
    case 'normal':
      return baseScore;
    case 'gammon':
      return baseScore * 2;
    case 'backgammon':
      return baseScore * 3;
  }
}

/**
 * Export the game engine interface
 */
export const GameEngine = {
  createGame,
  rollForFirst,
  rollDice,
  rollTurn,
  makeMove,
  offerDouble,
  respondToDouble,
  getLegalMoves,
  calculateScore,
  hasLegalMoves
};
