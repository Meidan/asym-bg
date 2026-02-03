/**
 * Core types for backgammon game engine
 */

export type Player = 'white' | 'black';

export type GamePhase = 'setup' | 'rolling' | 'moving' | 'gameOver';

/**
 * Points are numbered 1-24 from white's perspective:
 * - Points 1-6: White's home board
 * - Points 7-12: White's outer board
 * - Points 13-18: Black's outer board
 * - Points 19-24: Black's home board
 * 
 * Point 0 represents the bar for white
 * Point 25 represents the bar for black
 */
export type Point = number; // 0-25

export interface CheckerStack {
  player: Player;
  count: number;
}

/**
 * Board state represented as an array of checker stacks
 * Index 0 = white's bar
 * Index 1-24 = board points
 * Index 25 = black's bar
 */
export type BoardState = (CheckerStack | null)[];

export interface Dice {
  die1: number;
  die2: number;
}

/**
 * Convert Dice object to array of values
 * For doubles, returns 4 dice values
 */
export function getDiceValues(dice: Dice): number[] {
  if (dice.die1 === dice.die2) {
    // Doubles: return 4 of the same value
    return [dice.die1, dice.die1, dice.die1, dice.die1];
  }
  return [dice.die1, dice.die2];
}

export interface Move {
  from: Point; // In player's perspective (1-24)
  to: Point;   // In player's perspective (1-24, or -1/26 for bearing off, 0/25 for bar)
  die: number; // The die value used for this move (1-6)
  hit?: boolean;
}

/**
 * A complete turn may consist of multiple moves
 */
export interface Turn {
  player: Player;
  dice: Dice;
  moves: Move[];
}

export interface DoublingCube {
  value: number; // 1, 2, 4, 8, 16, 32, 64
  owner: Player | null; // null means centered (both can double)
}

/**
 * Game variant configuration
 */
export type GameVariant = 'standard' | 'asymmetric';

export interface AsymmetricRoles {
  foresightPlayer: Player; // sees opponent's dice, rolls for both
  doublingPlayer: Player; // always owns doubling cube
}

/**
 * Complete game state
 */
export interface GameState {
  variant: GameVariant;
  board: BoardState;
  currentPlayer: Player;
  phase: GamePhase;
  
  // Dice state
  whiteDice: Dice | null;
  blackDice: Dice | null;
  unusedDice: number[]; // dice values that haven't been used yet this turn
  
  // Doubling cube
  doublingCube: DoublingCube;
  stakes: number; // current value of the game
  doubleOfferedThisTurn: boolean; // track if double was offered this turn (asymmetric variant)
  
  // Asymmetric variant specific
  asymmetricRoles?: AsymmetricRoles;
  
  // Borne off checkers
  whiteOff: number;
  blackOff: number;
  
  // Move history
  moveHistory: Turn[];
  
  // Winner
  winner: Player | null;
  winType?: 'normal' | 'gammon' | 'backgammon';
  pointsAwarded?: number; // Points awarded to winner (cube value × win type multiplier)
}

/**
 * Result of attempting a move
 */
export interface MoveResult {
  valid: boolean;
  error?: string;
  newState?: GameState;
}

/**
 * Player interface for AI/Network abstraction
 */
export interface IPlayer {
  getMove(state: GameState, legalMoves: Move[][]): Promise<Move[]>;
  offerDouble?(state: GameState): Promise<boolean>;
  acceptDouble?(state: GameState): Promise<boolean>;
}

/**
 * Game configuration
 */
export interface GameConfig {
  variant: GameVariant;
  whitePlayer?: IPlayer;
  blackPlayer?: IPlayer;
  asymmetricRoles?: AsymmetricRoles;
}
