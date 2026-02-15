/**
 * Move validation and generation
 */

import {
  GameState,
  Move,
  Player,
  Point,
  Dice,
  BoardState,
  MoveResult,
  getDiceValues
} from './types';
import {
  hasCheckersOnBar,
  getBarPoint,
  isPointBlocked,
  isBlot,
  getCheckerCount,
  allCheckersInHomeBoard,
  isInHomeBoard,
  cloneBoard,
  applyMoveToBoard,
  isBearingOff,
  playerPointToBoardPoint,
  boardPointToPlayerPoint
} from './board';

/**
 * Get all legal moves for the current game state
 */
export function getLegalMoves(state: GameState): Move[][] {
  if (state.phase !== 'moving' || !state.unusedDice || state.unusedDice.length === 0) {
    return [];
  }
  
  const moves = generateAllPossibleMoveSequences(
    state.board,
    state.currentPlayer,
    state.unusedDice
  );
  
  return moves;
}

/**
 * Generate all possible move sequences for given dice
 */
export function generateAllPossibleMoveSequences(
  board: BoardState,
  player: Player,
  dice: number[]
): Move[][] {
  const sequences: Move[][] = [];
  
  // Use depth-first search to find all valid move sequences
  function search(currentBoard: BoardState, remainingDice: number[], currentMoves: Move[]) {
    if (remainingDice.length === 0) {
      // We've used all dice
      if (currentMoves.length > 0) {
        sequences.push([...currentMoves]);
      }
      return;
    }
    
    let foundAnyMove = false;
    
    // Try each remaining die value
    for (let i = 0; i < remainingDice.length; i++) {
      const die = remainingDice[i];
      const possibleMoves = generateMovesForDie(currentBoard, player, die);
      
      for (const move of possibleMoves) {
        // Convert player perspective move to board coordinates
        const fromBoard = move.from === 0 || move.from === 25 
          ? move.from 
          : playerPointToBoardPoint(move.from, player);
        const toBoard = move.to === -1 
          ? -1 
          : (move.to === 0 || move.to === 25 
              ? move.to 
              : playerPointToBoardPoint(move.to, player));
        
        // Apply move to a copy of the board
        const newBoard = cloneBoard(currentBoard);
        const hit = toBoard >= 1 && toBoard <= 24 && isBlot(newBoard, toBoard, player);
        
        let moveApplied = false;
        if (toBoard === -1) {
          // Bearing off
          const fromStack = newBoard[fromBoard];
          if (fromStack && fromStack.player === player && fromStack.count > 0) {
            fromStack.count--;
            if (fromStack.count === 0) newBoard[fromBoard] = null;
            moveApplied = true;
          }
        } else {
          moveApplied = applyMoveToBoard(newBoard, fromBoard, toBoard, player);
        }
        
        if (moveApplied) {
          foundAnyMove = true;
          
          // Remove used die and continue search
          const newRemainingDice = [...remainingDice];
          newRemainingDice.splice(i, 1);
          
          search(newBoard, newRemainingDice, [...currentMoves, { ...move, hit }]);
        }
      }
    }
    
    // If we couldn't make any moves with remaining dice, this is a valid endpoint
    if (!foundAnyMove && currentMoves.length > 0) {
      sequences.push([...currentMoves]);
    }
  }
  
  search(board, dice, []);
  
  // Filter to only the longest sequences (must use as many dice as possible)
  if (sequences.length > 0) {
    const maxLength = Math.max(...sequences.map(seq => seq.length));
    let filtered = sequences.filter(seq => seq.length === maxLength);

    // If only one move can be made with two different dice, must use the higher die.
    if (dice.length === 2 && dice[0] !== dice[1] && maxLength === 1) {
      const higherDie = Math.max(dice[0], dice[1]);
      const higherDieMoves = filtered.filter(seq => seq[0].die === higherDie);
      if (higherDieMoves.length > 0) {
        filtered = higherDieMoves;
      }
    }

    return filtered;
  }
  
  return [];
}

/**
 * Generate all possible moves for a single die value
 * Returns moves in player's perspective (1-24)
 * EXPORTED so Board.tsx can use the same logic for preview
 */
export function generateMovesForDie(board: BoardState, player: Player, die: number): Move[] {
  const moves: Move[] = [];
  
  // If on bar, must enter first
  if (hasCheckersOnBar(board, player)) {
    // Entry point is on opponent's home board: white enters on 24-19, black on 1-6
    const entryPlayerPoint = 25 - die;
    const entryBoardPoint = playerPointToBoardPoint(entryPlayerPoint, player);
    
    if (canMoveTo(board, entryBoardPoint, player)) {
      moves.push({ 
        from: player === 'white' ? 0 : 25, // Bar in special coordinates
        to: entryPlayerPoint, // Player's point 1-6
        die: die
      });
    }
    
    return moves;
  }
  
  // Check if we can bear off
  const canBearOff = allCheckersInHomeBoard(board, player);
  
  // Try moving from each point (in player's perspective)
  for (let playerPoint = 1; playerPoint <= 24; playerPoint++) {
    const boardPoint = playerPointToBoardPoint(playerPoint, player);
    
    if (getCheckerCount(board, boardPoint, player) === 0) continue;
    
    // Destination in player's perspective
    const destPlayerPoint = playerPoint - die; // Moving toward point 1
    const destBoardPoint = playerPointToBoardPoint(destPlayerPoint, player);
    
    // Normal move
    if (destPlayerPoint >= 1 && destPlayerPoint <= 24) {
      if (canMoveTo(board, destBoardPoint, player)) {
        moves.push({ from: playerPoint, to: destPlayerPoint, die: die });
      }
    }
    // Bearing off
    else if (canBearOff && destPlayerPoint < 1) {
      // Check if this point is in home board (player's points 1-6)
      if (playerPoint >= 1 && playerPoint <= 6) {
        // Exact bear off
        if (destPlayerPoint === 0) {
          moves.push({ from: playerPoint, to: -1, die: die }); // -1 = bearing off
        }
        // Bear off with higher die than needed
        else if (destPlayerPoint < 0) {
          if (canBearOffFromPlayerPoint(board, playerPoint, player)) {
            moves.push({ from: playerPoint, to: -1, die: die });
          }
        }
      }
    }
  }
  
  return moves;
}

/**
 * Check if a checker can move to a specific point
 * EXPORTED for use in Board.tsx
 */
export function canMoveTo(board: BoardState, point: Point, player: Player): boolean {
  if (point < 1 || point > 24) return false;
  return !isPointBlocked(board, point, player);
}

/**
 * Check if a checker can bear off from a specific player point with a die larger than needed
 * playerPoint is in player's perspective (1-6 in home board)
 * EXPORTED for use in Board.tsx
 */
export function canBearOffFromPlayerPoint(board: BoardState, playerPoint: Point, player: Player): boolean {
  // Check if there are any checkers on higher points (in player's perspective)
  // Higher points = closer to 24, farther from bearing off
  for (let p = playerPoint + 1; p <= 6; p++) {
    const boardPoint = playerPointToBoardPoint(p, player);
    if (getCheckerCount(board, boardPoint, player) > 0) {
      return false;
    }
  }
  
  return true;
}

/**
 * Validate and apply a sequence of moves
 * Moves are in player's perspective
 */
export function validateAndApplyMoves(state: GameState, moves: Move[]): MoveResult {
  if (state.phase !== 'moving') {
    return { valid: false, error: 'Not in moving phase' };
  }
  
  if (!state.unusedDice || state.unusedDice.length === 0) {
    return { valid: false, error: 'No dice available to use' };
  }
  
  // Handle pass turn (empty move sequence) when no legal moves available
  if (moves.length === 0) {
    const legalMoves = getLegalMoves(state);
    if (legalMoves.length === 0) {
      // No legal moves available, turn passes. Return a cloned state so callers
      // (e.g. projections) never mutate the original state object.
      return {
        valid: true,
        newState: {
          ...state,
          board: cloneBoard(state.board),
          unusedDice: [...state.unusedDice],
          moveHistory: [...state.moveHistory]
        }
      };
    } else {
      return { valid: false, error: 'Must make a legal move when available' };
    }
  }
  
  // Clone the state
  const newState: GameState = {
    ...state,
    board: cloneBoard(state.board),
    unusedDice: [...state.unusedDice],
    moveHistory: [...state.moveHistory]
  };
  
  // Validate that this move sequence is legal
  const legalMoveSequences = getLegalMoves(state);
  const isLegal = legalMoveSequences.some(legalSeq => 
    movesEqual(legalSeq, moves)
  );
  
  if (!isLegal) {
    return { valid: false, error: 'Invalid move sequence' };
  }
  
  // Apply each move
  for (const move of moves) {
    // Use the die value that was tracked when the move was generated
    const die = move.die;
    
    // Convert to board coordinates
    const fromBoard = move.from === 0 || move.from === 25 
      ? move.from 
      : playerPointToBoardPoint(move.from, state.currentPlayer);
    const toBoard = move.to === -1 
      ? -1 
      : (move.to === 0 || move.to === 25 
          ? move.to 
          : playerPointToBoardPoint(move.to, state.currentPlayer));
    
    // Remove die from unused dice
    const dieIndex = newState.unusedDice.indexOf(die);
    if (dieIndex === -1) {
      return { valid: false, error: 'Invalid die used' };
    }
    newState.unusedDice.splice(dieIndex, 1);
    
    // Apply move to board
    if (move.to === -1) {
      // Bearing off
      const fromStack = newState.board[fromBoard];
      if (fromStack && fromStack.player === state.currentPlayer) {
        fromStack.count--;
        if (fromStack.count === 0) {
          newState.board[fromBoard] = null;
        }
        if (state.currentPlayer === 'white') {
          newState.whiteOff++;
        } else {
          newState.blackOff++;
        }
      }
    } else {
      applyMoveToBoard(newState.board, fromBoard, toBoard, state.currentPlayer);
    }
  }
  
  return { valid: true, newState };
}

/**
 * Compare two move sequences for equality
 */
function movesEqual(moves1: Move[], moves2: Move[]): boolean {
  if (moves1.length !== moves2.length) return false;
  
  // Create sorted copies for comparison (order might differ)
  const sorted1 = [...moves1].sort((a, b) => {
    if (a.from !== b.from) return a.from - b.from;
    if (a.to !== b.to) return a.to - b.to;
    return a.die - b.die;
  });
  const sorted2 = [...moves2].sort((a, b) => {
    if (a.from !== b.from) return a.from - b.from;
    if (a.to !== b.to) return a.to - b.to;
    return a.die - b.die;
  });
  
  return sorted1.every((move, i) => 
    move.from === sorted2[i].from &&
    move.to === sorted2[i].to &&
    move.die === sorted2[i].die
  );
}

/**
 * Check if player has any legal moves
 */
export function hasLegalMoves(state: GameState): boolean {
  const legalMoves = getLegalMoves(state);
  return legalMoves.length > 0;
}
