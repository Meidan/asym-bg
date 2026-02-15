import React, { useState, useCallback } from 'react';
import {
  GameState,
  Move,
  Point,
  Player,
  getDiceValues,
  getSingleAsymmetricRolePlayer,
  playerHasAsymmetricRole
} from '../engine/types';
import { getCheckerCount, getOpponent, playerPointToBoardPoint, boardPointToPlayerPoint, allCheckersInHomeBoard, isPointBlocked, hasCheckersOnBar, getBarPoint, countPips } from '../engine/board';
import { generateMovesForDie } from '../engine/moves';
import Checker from './Checker';
import './Board.css';

interface BoardProps {
  gameState: GameState;
  baseGameState: GameState;
  legalMoves: Move[][];
  selectedMoveSequence: Move[];
  opponentPreviewMoves?: Move[];
  doubleOffered: boolean;
  isFirstTurn: boolean;
  playerPerspective: Player | null; // Player perspective for multiplayer
  canDouble: boolean; // Whether doubling is allowed (considering match state)
  crawfordGame: boolean; // Whether this is a Crawford game
  onAddMove: (move: Move) => void;
  onSelectMoveSequence: (moves: Move[]) => void;
  onExecuteMove: () => void;
  onUndoMove: () => void;
  onRollDice: () => void;
  onOfferDouble: () => void;
  onRespondToDouble: (accept: boolean) => void;
}

const Board: React.FC<BoardProps> = ({ 
  gameState, 
  baseGameState,
  legalMoves, 
  selectedMoveSequence,
  doubleOffered,
  opponentPreviewMoves = [],
  isFirstTurn,
  playerPerspective,
  canDouble,
  crawfordGame,
  onAddMove,
  onSelectMoveSequence,
  onExecuteMove,
  onUndoMove,
  onRollDice,
  onOfferDouble,
  onRespondToDouble
}) => {
  // Check if it's our turn (for multiplayer)
  const isOurTurn = baseGameState.currentPlayer === playerPerspective;
  
  // Determine if board should be flipped (black's perspective)
  const flipBoard = playerPerspective === 'black';
  const topPlayer: Player = flipBoard ? 'white' : 'black';
  const bottomPlayer: Player = flipBoard ? 'black' : 'white';
  
  // Find valid moves from current position given already-made moves
  // Uses the SAME logic as the engine to avoid discrepancies
  const getAvailableMovesFromPoint = useCallback((fromPlayerPoint: Point): Move[] => {
    // Calculate remaining dice using the SAME logic as App.tsx
    const usedDiceValues: number[] = [];
    selectedMoveSequence.forEach(move => {
      const dieUsed = move.die;
      usedDiceValues.push(dieUsed);
    });
    
    const remainingDice = [...baseGameState.unusedDice];
    usedDiceValues.forEach(usedDie => {
      const index = remainingDice.indexOf(usedDie);
      if (index >= 0) {
        remainingDice.splice(index, 1);
      }
    });
    
    if (remainingDice.length === 0) return [];
    
    const player = baseGameState.currentPlayer;
    
    // Check if player has checkers on bar using preview board state
    const barPoint = getBarPoint(player);
    const onBar = hasCheckersOnBar(gameState.board, player);
    
    // If on bar, MUST move from bar first (can't click other checkers)
    if (onBar) {
      if (fromPlayerPoint !== 0 && fromPlayerPoint !== 25) {
        return []; // Can't move other pieces while on bar
      }
    }
    
    // Check if the point we're clicking has our checkers (in preview state)
    const boardPoint = playerPointToBoardPoint(fromPlayerPoint, player);
    const currentStack = gameState.board[boardPoint];
    
    if (!currentStack || currentStack.player !== player || currentStack.count === 0) {
      return [];
    }
    
    // Get all possible moves from this point using remaining dice
    // Use the ENGINE's move generation for each remaining die
    const possibleMoves: Move[] = [];
    
    for (const die of remainingDice) {
      // Use engine's generateMovesForDie - this ensures consistency
      const allMovesForDie = generateMovesForDie(gameState.board, player, die);
      
      // Filter to only moves from our point
      const movesFromThisPoint = allMovesForDie.filter(m => m.from === fromPlayerPoint);
      possibleMoves.push(...movesFromThisPoint);
    }
    
    return possibleMoves;
  }, [baseGameState, gameState, selectedMoveSequence]);

  const handleEmptyPointClick = useCallback((boardPoint: Point) => {
    if (!isOurTurn) return;
    if (baseGameState.phase !== 'moving') return;
    if (selectedMoveSequence.length > 0) return;

    const targetPlayerPoint = boardPointToPlayerPoint(boardPoint, baseGameState.currentPlayer);
    const sequencesEnding = legalMoves.filter(seq =>
      seq.length > 0 && seq[seq.length - 1].to === targetPlayerPoint
    );
    const allMovesEndOnTarget = sequencesEnding.filter(seq =>
      seq.every(move => move.to === targetPlayerPoint)
    );
    const candidates = allMovesEndOnTarget.length > 0
      ? allMovesEndOnTarget
      : sequencesEnding;

    if (candidates.length === 0) return;
    const maxLength = Math.max(...candidates.map(seq => seq.length));
    const chosen = candidates.find(seq => seq.length === maxLength) || candidates[0];
    onSelectMoveSequence(chosen);
  }, [isOurTurn, baseGameState.phase, baseGameState.currentPlayer, selectedMoveSequence.length, legalMoves, onSelectMoveSequence]);

  // Handle point click (anywhere on the point with checkers)
  const handlePointClick = useCallback((playerPoint: Point, player: Player, useLowestDie: boolean) => {
    // Check if it's our turn (for multiplayer)
    if (!isOurTurn) {
      return;
    }
    
    if (baseGameState.phase !== 'moving') {
      return;
    }
    if (player !== baseGameState.currentPlayer) {
      return;
    }
    
    const availableMoves = getAvailableMovesFromPoint(playerPoint);
    
    if (availableMoves.length === 0) {
      return;
    }
    
    // Sort moves by die value
    const sortedMoves = [...availableMoves].sort((a, b) => {
      const dieA = a.die;
      const dieB = b.die;
      return useLowestDie ? dieA - dieB : dieB - dieA;
    });
    
    // Use the first move (highest or lowest die)
    onAddMove(sortedMoves[0]);
  }, [baseGameState, getAvailableMovesFromPoint, onAddMove]);

  // Render a single point (boardPoint is always in board coordinates 1-24)
  const renderPoint = (boardPoint: Point, isTop: boolean) => {
    const stack = gameState.board[boardPoint];
    const count = stack?.count || 0;
    const player = stack?.player;
    
    // Convert to player perspective
    const playerPointWhite = boardPointToPlayerPoint(boardPoint, 'white');
    const playerPointBlack = boardPointToPlayerPoint(boardPoint, 'black');
    
    // Check if this point is in selected sequence
    const isInSelectedSequence = selectedMoveSequence.some(
      move => {
        const moveFromBoard = move.from === 0 || move.from === 25 
          ? move.from 
          : playerPointToBoardPoint(move.from, baseGameState.currentPlayer);
        const moveToBoard = move.to === -1 
          ? -1 
          : (move.to === 0 || move.to === 25 
              ? move.to 
              : playerPointToBoardPoint(move.to, baseGameState.currentPlayer));
        return moveFromBoard === boardPoint || moveToBoard === boardPoint;
      }
    );

    // Check if this point has a checker that can move
    const currentPlayerPoint = baseGameState.currentPlayer === 'white' ? playerPointWhite : playerPointBlack;
    const canMoveFrom = baseGameState.phase === 'moving' && 
                        player === baseGameState.currentPlayer &&
                        count > 0 &&
                        isOurTurn; // Only allow clicks if it's our turn
    const isEmptyPoint = count === 0;
    const isOpponentBlot = count === 1 && player && player !== baseGameState.currentPlayer;

    const isInOpponentPreview = opponentPreviewMoves.some(move => {
      const moveFromBoard = move.from === 0 || move.from === 25
        ? move.from
        : playerPointToBoardPoint(move.from, baseGameState.currentPlayer);
      const moveToBoard = move.to === -1
        ? -1
        : (move.to === 0 || move.to === 25
          ? move.to
          : playerPointToBoardPoint(move.to, baseGameState.currentPlayer));
      return moveFromBoard === boardPoint || moveToBoard === boardPoint;
    });

    return (
      <div
        key={boardPoint}
        className={`point ${isTop ? 'point-top' : 'point-bottom'} ${
          boardPoint % 2 === 0 ? 'point-light' : 'point-dark'
        } ${canMoveFrom ? 'point-can-move' : ''} ${
          isInSelectedSequence ? 'point-selected' : ''
        } ${isInOpponentPreview ? 'point-opponent-preview' : ''
        }`}
        data-point={boardPoint}
        onClick={(e) => {
          if (canMoveFrom && isOurTurn) {
            handlePointClick(currentPlayerPoint, player!, false);
          } else if (isEmptyPoint || isOpponentBlot) {
            handleEmptyPointClick(boardPoint);
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          if (canMoveFrom && isOurTurn) {
            handlePointClick(currentPlayerPoint, player!, true);
          }
        }}
      >
        <div className="point-number">{boardPoint}</div>
        <div className={`checkers-stack ${isTop ? 'stack-top' : 'stack-bottom'}`}>
          {Array.from({ length: Math.min(count, 5) }).map((_, i) => (
            <Checker
              key={i}
              player={player!}
              position={i}
              total={count}
              onClick={(useLowest) => {
                handlePointClick(currentPlayerPoint, player!, useLowest);
              }}
              isClickable={canMoveFrom}
            />
          ))}
          {count > 5 && (
            <div className="checker-count-badge">
              {count}
            </div>
          )}
        </div>
      </div>
    );
  };

  // Render the bar
  const renderBar = () => {
    const whiteOnBar = getCheckerCount(gameState.board, 0, 'white');
    const blackOnBar = getCheckerCount(gameState.board, 25, 'black');

    return (
      <div className="bar">
        <div 
          className="bar-section bar-top"
          onClick={() => {
            if (blackOnBar > 0 && baseGameState.currentPlayer === 'black' && isOurTurn) {
              handlePointClick(25, 'black', false);
            }
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            if (blackOnBar > 0 && baseGameState.currentPlayer === 'black' && isOurTurn) {
              handlePointClick(25, 'black', true);
            }
          }}
        >
          {Array.from({ length: Math.min(blackOnBar, 3) }).map((_, i) => (
            <Checker
              key={i}
              player="black"
              position={i}
              total={blackOnBar}
              onClick={(useLowest) => handlePointClick(25, 'black', useLowest)}
              isClickable={baseGameState.phase === 'moving' && baseGameState.currentPlayer === 'black' && isOurTurn}
            />
          ))}
          {blackOnBar > 3 && (
            <div className="checker-count-badge">{blackOnBar}</div>
          )}
        </div>
        <div 
          className="bar-section bar-bottom"
          onClick={() => {
            if (whiteOnBar > 0 && baseGameState.currentPlayer === 'white' && isOurTurn) {
              handlePointClick(0, 'white', false);
            }
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            if (whiteOnBar > 0 && baseGameState.currentPlayer === 'white' && isOurTurn) {
              handlePointClick(0, 'white', true);
            }
          }}
        >
          {Array.from({ length: Math.min(whiteOnBar, 3) }).map((_, i) => (
            <Checker
              key={i}
              player="white"
              position={i}
              total={whiteOnBar}
              onClick={(useLowest) => handlePointClick(0, 'white', useLowest)}
              isClickable={baseGameState.phase === 'moving' && baseGameState.currentPlayer === 'white' && isOurTurn}
            />
          ))}
          {whiteOnBar > 3 && (
            <div className="checker-count-badge">{whiteOnBar}</div>
          )}
        </div>
      </div>
    );
  };

  // Render borne off area
  const renderBorneOff = () => {
    return (
      <div className="borne-off-area">
        <div className="borne-off-section borne-off-top">
          <div className="borne-off-label">{topPlayer === 'black' ? 'Black Off' : 'White Off'}</div>
          <div className="borne-off-count">{topPlayer === 'black' ? gameState.blackOff : gameState.whiteOff}</div>
          {(topPlayer === 'black' ? gameState.blackOff : gameState.whiteOff) > 0 && (
            <div className="borne-off-checkers">
              {Array.from({ length: Math.min(topPlayer === 'black' ? gameState.blackOff : gameState.whiteOff, 3) }).map((_, i) => (
                <Checker
                  key={i}
                  player={topPlayer}
                  position={i}
                  total={topPlayer === 'black' ? gameState.blackOff : gameState.whiteOff}
                  onClick={() => {}}
                  isClickable={false}
                />
              ))}
            </div>
          )}
        </div>
        <div className="borne-off-section borne-off-bottom">
          <div className="borne-off-label">{bottomPlayer === 'black' ? 'Black Off' : 'White Off'}</div>
          <div className="borne-off-count">{bottomPlayer === 'black' ? gameState.blackOff : gameState.whiteOff}</div>
          {(bottomPlayer === 'black' ? gameState.blackOff : gameState.whiteOff) > 0 && (
            <div className="borne-off-checkers">
              {Array.from({ length: Math.min(bottomPlayer === 'black' ? gameState.blackOff : gameState.whiteOff, 3) }).map((_, i) => (
                <Checker
                  key={i}
                  player={bottomPlayer}
                  position={i}
                  total={bottomPlayer === 'black' ? gameState.blackOff : gameState.whiteOff}
                  onClick={() => {}}
                  isClickable={false}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="board-container">
      <div className={`board ${flipBoard ? 'board-flipped' : ''}`}>
        <div className="pip-count pip-top">
          <div className={`pip-label pip-${topPlayer}`}>{topPlayer}</div>
          <div className="pip-value">{countPips(gameState.board, topPlayer)}</div>
        </div>
        <div className="pip-count pip-bottom">
          <div className={`pip-label pip-${bottomPlayer}`}>{bottomPlayer}</div>
          <div className="pip-value">{countPips(gameState.board, bottomPlayer)}</div>
        </div>
        {/* Top half of board - changes based on perspective */}
        <div className="board-half board-top">
          <div className="quadrant quadrant-top-left">
            {flipBoard 
              ? [12, 11, 10, 9, 8, 7].map(point => renderPoint(point, true))
              : [13, 14, 15, 16, 17, 18].map(point => renderPoint(point, true))
            }
          </div>
          {renderBar()}
          <div className="quadrant quadrant-top-right">
            {flipBoard
              ? [6, 5, 4, 3, 2, 1].map(point => renderPoint(point, true))
              : [19, 20, 21, 22, 23, 24].map(point => renderPoint(point, true))
            }
          </div>
        </div>

        {/* Center area for buttons/dice/cube */}
        <div className="board-center">
          {/* Left side: Opponent's dice (from our perspective) OR undo/double buttons if it's our turn */}
          <div className="board-center-left">
            {/* Determine opponent player */}
            {(() => {
              if (doubleOffered && !isOurTurn) {
                return (
                  <button
                    className="board-inline-btn board-inline-double"
                    onClick={() => onRespondToDouble(false)}
                  >
                    pass
                  </button>
                );
              }

              const opponentPlayer = playerPerspective 
                ? (playerPerspective === 'white' ? 'black' : 'white')
                : (baseGameState.currentPlayer === 'white' ? 'black' : 'white');
              
              // ASYMMETRIC: Show opponent's dice if we're the foresight player
              if (baseGameState.variant === 'asymmetric' && 
                  baseGameState.asymmetricRoles &&
                  playerHasAsymmetricRole(baseGameState.asymmetricRoles, baseGameState.currentPlayer, 'foresight') &&
                  baseGameState.phase === 'moving') {
                const opponentDiceObject = opponentPlayer === 'white' ? baseGameState.whiteDice! : baseGameState.blackDice!;
                if (opponentDiceObject) {
                  const opponentDice = getDiceValues(opponentDiceObject);
                  let showDoubleInForesightView = false;
                  if (!doubleOffered && !isFirstTurn && isOurTurn && canDouble && selectedMoveSequence.length === 0) {
                    const fixedDoublingPlayer = getSingleAsymmetricRolePlayer(baseGameState.asymmetricRoles, 'doubling');
                    if (fixedDoublingPlayer) {
                      showDoubleInForesightView = playerHasAsymmetricRole(baseGameState.asymmetricRoles, baseGameState.currentPlayer, 'doubling') &&
                        !baseGameState.doubleOfferedThisTurn &&
                        baseGameState.doublingCube.value < 64;
                    } else {
                      showDoubleInForesightView = (baseGameState.doublingCube.owner === null || baseGameState.doublingCube.owner === baseGameState.currentPlayer) &&
                        !baseGameState.doubleOfferedThisTurn &&
                        baseGameState.doublingCube.value < 64;
                    }
                  }
                  
                  return (
                    <div className="board-inline-group">
                      <div className={`board-inline-dice-simple dice-${opponentPlayer}`}>
                        {opponentDice.map((die, i) => (
                          <div 
                            key={i} 
                            className={`inline-die die-${opponentPlayer}`}
                          >
                            {die}
                          </div>
                        ))}
                      </div>
                      {selectedMoveSequence.length > 0 && isOurTurn && (
                        <button 
                          className="board-inline-btn board-inline-undo"
                          onClick={onUndoMove}
                        >
                          ↶ undo
                        </button>
                      )}
                      {showDoubleInForesightView && (
                        <button
                          className="board-inline-btn board-inline-double"
                          onClick={onOfferDouble}
                        >
                          double
                        </button>
                      )}
                    </div>
                  );
                }
              }
              
              // Show opponent's dice if they're moving (normal case)
              if (baseGameState.phase === 'moving' && baseGameState.unusedDice && baseGameState.currentPlayer === opponentPlayer) {
                const diceObject = opponentPlayer === 'white' ? baseGameState.whiteDice! : baseGameState.blackDice!;
                const dice = getDiceValues(diceObject);
                
                return (
                  <div className={`board-inline-dice-simple dice-${opponentPlayer}`}>
                    {dice.map((die, i) => {
                      const remainingCount = gameState.unusedDice.filter(d => d === die).length;
                      const thisInstanceUsed = dice.slice(0, i + 1).filter(d => d === die).length > remainingCount;
                      
                      return (
                        <div 
                          key={i} 
                          className={`inline-die die-${opponentPlayer} ${thisInstanceUsed ? 'die-used' : ''}`}
                        >
                          {die}
                        </div>
                      );
                    })}
                  </div>
                );
              }
              
              // Show undo button if our turn and we have moves
              if (baseGameState.phase === 'moving' && selectedMoveSequence.length > 0 && isOurTurn) {
                return (
                  <button 
                    className="board-inline-btn board-inline-undo"
                    onClick={onUndoMove}
                  >
                    ↶ undo
                  </button>
                );
              }
              
              // Show double button if we can double
              if (!doubleOffered && !isFirstTurn && isOurTurn && canDouble) {
                let showDouble = false;
                let canOfferDoubleInRolling = false;
                
                if (baseGameState.phase === 'rolling') {
                  canOfferDoubleInRolling = baseGameState.variant !== 'asymmetric' &&
                    (baseGameState.doublingCube.owner === null || baseGameState.doublingCube.owner === baseGameState.currentPlayer) &&
                    baseGameState.doublingCube.value < 64;
                  showDouble = baseGameState.variant === 'asymmetric'
                    ? false
                    : canOfferDoubleInRolling;
                } else if (baseGameState.phase === 'moving' && baseGameState.variant === 'asymmetric' && selectedMoveSequence.length === 0) {
                  if (baseGameState.asymmetricRoles) {
                    const fixedDoublingPlayer = getSingleAsymmetricRolePlayer(baseGameState.asymmetricRoles, 'doubling');
                    if (fixedDoublingPlayer) {
                      showDouble = playerHasAsymmetricRole(baseGameState.asymmetricRoles, baseGameState.currentPlayer, 'doubling') &&
                                 !baseGameState.doubleOfferedThisTurn &&
                                 baseGameState.doublingCube.value < 64;
                    } else {
                      showDouble = (baseGameState.doublingCube.owner === null || baseGameState.doublingCube.owner === baseGameState.currentPlayer) &&
                                 !baseGameState.doubleOfferedThisTurn &&
                                 baseGameState.doublingCube.value < 64;
                    }
                  }
                }
                
                if (showDouble) {
                  return (
                    <button 
                      className="board-inline-btn board-inline-double"
                      onClick={onOfferDouble}
                    >
                      double
                    </button>
                  );
                }
              }
              
              return null;
            })()}
          </div>

          {/* Right side: Our dice OR Roll button (from our perspective) */}
          <div className="board-center-right">
            {/* Determine our player */}
            {(() => {
              if (doubleOffered && !isOurTurn) {
                return (
                  <button
                    className="board-inline-btn board-inline-roll"
                    onClick={() => onRespondToDouble(true)}
                  >
                    accept
                  </button>
                );
              }

              const ourPlayer = playerPerspective || baseGameState.currentPlayer;
              
              // Show our dice if we're moving
              if (baseGameState.phase === 'moving' && baseGameState.unusedDice && baseGameState.currentPlayer === ourPlayer && isOurTurn) {
                const diceObject = ourPlayer === 'white' ? baseGameState.whiteDice! : baseGameState.blackDice!;
                const dice = getDiceValues(diceObject);
                
                return (
                  <div 
                    className={`board-inline-dice-simple dice-${ourPlayer}`}
                    onClick={selectedMoveSequence.length > 0 ? onExecuteMove : undefined}
                    style={{ cursor: selectedMoveSequence.length > 0 ? 'pointer' : 'default' }}
                  >
                    {dice.map((die, i) => {
                      const remainingCount = gameState.unusedDice.filter(d => d === die).length;
                      const thisInstanceUsed = dice.slice(0, i + 1).filter(d => d === die).length > remainingCount;
                      
                      return (
                        <div 
                          key={i} 
                          className={`inline-die die-${ourPlayer} ${thisInstanceUsed ? 'die-used' : ''}`}
                        >
                          {die}
                        </div>
                      );
                    })}
                  </div>
                );
              }
              
              // Show roll button if it's our turn to roll
              const canOfferDoubleInRolling = !doubleOffered &&
                !isFirstTurn &&
                isOurTurn &&
                canDouble &&
                baseGameState.phase === 'rolling' &&
                baseGameState.variant !== 'asymmetric' &&
                (baseGameState.doublingCube.owner === null || baseGameState.doublingCube.owner === baseGameState.currentPlayer) &&
                baseGameState.doublingCube.value < 64;

              if (canOfferDoubleInRolling) {
                return (
                  <button 
                    className="board-inline-btn board-inline-roll"
                    onClick={onRollDice}
                  >
                    roll
                  </button>
                );
              }
              
              return null;
            })()}
          </div>
        </div>

        {/* Doubling cube - displayed on right side outside board */}
        {(() => {
          const cubeOwner = baseGameState.doublingCube.owner;
          const cubeColorClass = cubeOwner === 'white'
            ? 'cube-white'
            : cubeOwner === 'black'
              ? 'cube-black'
              : 'cube-center';
          const cubePositionClass = cubeOwner === null
            ? ''
            : flipBoard
              ? (cubeOwner === 'white' ? 'cube-top' : 'cube-bottom')
              : (cubeOwner === 'white' ? 'cube-bottom' : 'cube-top');
          return (
            <div className={`doubling-cube-display ${cubeColorClass} ${cubePositionClass}`}>
        <div className="cube-face">{crawfordGame ? 'CR' : baseGameState.doublingCube.value}</div>
            </div>
          );
        })()}

        {/* Bottom half of board - changes based on perspective */}
        <div className="board-half board-bottom">
          <div className="quadrant quadrant-bottom-left">
            {flipBoard
              ? [13, 14, 15, 16, 17, 18].map(point => renderPoint(point, false))
              : [12, 11, 10, 9, 8, 7].map(point => renderPoint(point, false))
            }
          </div>
          <div className="bar-placeholder" />
          <div className="quadrant quadrant-bottom-right">
            {flipBoard
              ? [19, 20, 21, 22, 23, 24].map(point => renderPoint(point, false))
              : [6, 5, 4, 3, 2, 1].map(point => renderPoint(point, false))
            }
          </div>
        </div>

      </div>

      {renderBorneOff()}
    </div>
  );
};

export default React.memo(Board);
