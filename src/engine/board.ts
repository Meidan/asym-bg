/**
 * Board utilities and initialization
 */

import { BoardState, CheckerStack, Player, Point } from './types';

/**
 * Create initial backgammon board setup
 */
export function createInitialBoard(): BoardState {
  const board: BoardState = Array(26).fill(null);
  
  // Standard backgammon setup - using board coordinates (white's perspective)
  // White moves from high to low (board 24→1), bears off at 0
  // Black moves from low to high (board 1→24), bears off at 25
  
  // White's initial position
  board[24] = { player: 'white', count: 2 };  // White's 24-point
  board[13] = { player: 'white', count: 5 };  // White's mid-point
  board[8] = { player: 'white', count: 3 };   // White's 8-point
  board[6] = { player: 'white', count: 5 };   // White's 6-point (home board)
  
  // Black's initial position (mirror of white)
  board[1] = { player: 'black', count: 2 };   // Black's 24-point (board 1)
  board[12] = { player: 'black', count: 5 };  // Black's mid-point
  board[17] = { player: 'black', count: 3 };  // Black's 8-point
  board[19] = { player: 'black', count: 5 };  // Black's 6-point (home board)
  
  return board;
}

/**
 * Get the bar point for a player
 */
export function getBarPoint(player: Player): Point {
  return player === 'white' ? 0 : 25;
}

/**
 * Convert a player's point number (1-24 from their perspective) to board position
 * White: point 1 = board[1], point 24 = board[24]
 * Black: point 1 = board[24], point 24 = board[1] (mirror)
 */
export function playerPointToBoardPoint(playerPoint: Point, player: Player): Point {
  if (playerPoint === 0 || playerPoint === 25) return playerPoint; // Bar
  if (playerPoint < 1 || playerPoint > 24) return playerPoint; // Bear off
  
  return player === 'white' ? playerPoint : (25 - playerPoint);
}

/**
 * Convert board position to player's point number
 */
export function boardPointToPlayerPoint(boardPoint: Point, player: Player): Point {
  if (boardPoint === 0 || boardPoint === 25) return boardPoint; // Bar
  if (boardPoint < 1 || boardPoint > 24) return boardPoint; // Bear off
  
  return player === 'white' ? boardPoint : (25 - boardPoint);
}

/**
 * Get the home board range for a player (in board coordinates)
 */
export function getHomeBoard(player: Player): [number, number] {
  return player === 'white' ? [1, 6] : [19, 24];
}

/**
 * Check if a point is in a player's home board (board coordinates)
 */
export function isInHomeBoard(point: Point, player: Player): boolean {
  const [start, end] = getHomeBoard(player);
  return point >= start && point <= end;
}

/**
 * Check if a point is on the bar
 */
export function isBar(point: Point): boolean {
  return point === 0 || point === 25;
}

/**
 * Check if a point is valid bearing off for a player
 */
export function isBearingOff(from: Point, to: Point, player: Player): boolean {
  if (player === 'white') {
    return from >= 1 && from <= 6 && to === -1;
  } else {
    return from >= 19 && from <= 24 && to === 26;
  }
}

/**
 * Get opponent player
 */
export function getOpponent(player: Player): Player {
  return player === 'white' ? 'black' : 'white';
}

/**
 * Check if a player has checkers on the bar
 */
export function hasCheckersOnBar(board: BoardState, player: Player): boolean {
  const barPoint = getBarPoint(player);
  const stack = board[barPoint];
  return stack !== null && stack.count > 0;
}

/**
 * Count checkers for a player at a specific point
 */
export function getCheckerCount(board: BoardState, point: Point, player: Player): number {
  const stack = board[point];
  if (!stack || stack.player !== player) return 0;
  return stack.count;
}

/**
 * Check if all checkers are in home board (prerequisite for bearing off)
 */
export function allCheckersInHomeBoard(board: BoardState, player: Player): boolean {
  const [homeStart, homeEnd] = getHomeBoard(player);
  const barPoint = getBarPoint(player);
  
  // Check if any checkers on bar
  if (hasCheckersOnBar(board, player)) return false;
  
  // Check all points outside home board
  for (let point = 1; point <= 24; point++) {
    if (point >= homeStart && point <= homeEnd) continue;
    
    const stack = board[point];
    if (stack && stack.player === player && stack.count > 0) {
      return false;
    }
  }
  
  return true;
}

/**
 * Count total checkers for a player on the board (not borne off)
 */
export function countCheckersOnBoard(board: BoardState, player: Player): number {
  let count = 0;
  for (let point = 0; point <= 25; point++) {
    const stack = board[point];
    if (stack && stack.player === player) {
      count += stack.count;
    }
  }
  return count;
}

/**
 * Count total pip count for a player.
 * Pips are measured as distance to bear off (bar counts as 25).
 */
export function countPips(board: BoardState, player: Player): number {
  let total = 0;
  const barPoint = getBarPoint(player);
  const barStack = board[barPoint];
  if (barStack && barStack.player === player) {
    total += barStack.count * 25;
  }

  for (let point = 1; point <= 24; point++) {
    const stack = board[point];
    if (!stack || stack.player !== player) continue;
    const distance = player === 'white' ? point : (25 - point);
    total += distance * stack.count;
  }

  return total;
}

/**
 * Clone the board state
 */
export function cloneBoard(board: BoardState): BoardState {
  return board.map(stack => stack ? { ...stack } : null);
}

/**
 * Check if a point is occupied by opponent (and how many)
 */
export function isPointBlocked(board: BoardState, point: Point, player: Player): boolean {
  if (point < 0 || point > 25) return false;
  const stack = board[point];
  if (!stack) return false;
  return stack.player !== player && stack.count >= 2;
}

/**
 * Check if a point has a single opponent checker (blot)
 */
export function isBlot(board: BoardState, point: Point, player: Player): boolean {
  if (point < 0 || point > 25) return false;
  const stack = board[point];
  if (!stack) return false;
  return stack.player !== player && stack.count === 1;
}

/**
 * Apply a move to the board (mutates the board array)
 */
export function applyMoveToBoard(board: BoardState, from: Point, to: Point, player: Player): boolean {
  const fromStack = board[from];
  if (!fromStack || fromStack.player !== player || fromStack.count === 0) {
    return false;
  }
  
  // Remove checker from source
  fromStack.count--;
  if (fromStack.count === 0) {
    board[from] = null;
  }
  
  // Handle hit
  const toStack = board[to];
  if (toStack && toStack.player !== player) {
    if (toStack.count === 1) {
      // Hit the blot - send to bar
      const opponentBar = getBarPoint(toStack.player);
      const barStack = board[opponentBar];
      if (barStack) {
        barStack.count++;
      } else {
        board[opponentBar] = { player: toStack.player, count: 1 };
      }
      board[to] = null;
    } else {
      // Point is blocked, this shouldn't happen
      return false;
    }
  }
  
  // Add checker to destination
  if (board[to] === null || board[to]!.player === player) {
    if (board[to] === null) {
      board[to] = { player, count: 1 };
    } else {
      board[to]!.count++;
    }
  }
  
  return true;
}
