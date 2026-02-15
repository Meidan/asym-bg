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

export type AsymmetricRole = 'foresight' | 'doubling';

export interface AsymmetricRoles {
  white: AsymmetricRole;
  black: AsymmetricRole;
}

export interface LegacyAsymmetricRoles {
  foresightPlayer: Player;
  doublingPlayer: Player;
}

export type AsymmetricRolesConfig = AsymmetricRoles | LegacyAsymmetricRoles;

export function normalizeAsymmetricRoles(roles?: AsymmetricRolesConfig): AsymmetricRoles | undefined {
  if (!roles) return undefined;

  if ('white' in roles && 'black' in roles) {
    return {
      white: roles.white,
      black: roles.black
    };
  }

  if ('foresightPlayer' in roles && 'doublingPlayer' in roles) {
    const whiteRole = roles.foresightPlayer === 'white'
      ? 'foresight'
      : roles.doublingPlayer === 'white'
        ? 'doubling'
        : undefined;
    const blackRole = roles.foresightPlayer === 'black'
      ? 'foresight'
      : roles.doublingPlayer === 'black'
        ? 'doubling'
        : undefined;
    if (!whiteRole || !blackRole) return undefined;
    return {
      white: whiteRole,
      black: blackRole
    };
  }

  return undefined;
}

export function getAsymmetricRoleForPlayer(roles: AsymmetricRoles, player: Player): AsymmetricRole {
  return roles[player];
}

export function playerHasAsymmetricRole(
  roles: AsymmetricRoles,
  player: Player,
  role: AsymmetricRole
): boolean {
  return roles[player] === role;
}

export function getSingleAsymmetricRolePlayer(
  roles: AsymmetricRoles,
  role: AsymmetricRole
): Player | null {
  const whiteHasRole = roles.white === role;
  const blackHasRole = roles.black === role;
  if (whiteHasRole === blackHasRole) return null;
  return whiteHasRole ? 'white' : 'black';
}

export function isValidAsymmetricRoles(roles: AsymmetricRoles): boolean {
  // The only invalid combination is Doubling vs Doubling.
  return roles.white === 'foresight' || roles.black === 'foresight';
}

export function randomAsymmetricRoles(): AsymmetricRoles {
  const options: AsymmetricRoles[] = [
    { white: 'foresight', black: 'doubling' },
    { white: 'doubling', black: 'foresight' }
  ];
  return options[Math.floor(Math.random() * options.length)];
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
  asymmetricRoles?: AsymmetricRolesConfig;
}
