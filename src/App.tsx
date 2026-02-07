import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { GameEngine } from './engine';
import { GameState, Move, Player } from './engine/types';
import { cloneBoard, applyMoveToBoard, playerPointToBoardPoint } from './engine/board';
import { MatchState, canDoubleInMatch } from './engine/match';
import Board from './components/Board';
import Sidebar from './components/Sidebar';
import MultiplayerLobby from './components/MultiplayerLobby';
import TimePanel from './components/TimePanel';
import { MultiplayerProvider, useMultiplayer } from './multiplayer/MultiplayerContext';
import './App.css';

function GameApp() {
  const multiplayer = useMultiplayer();
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [matchState, setMatchState] = useState<MatchState | null>(null);
  const [pendingDoubleOfferer, setPendingDoubleOfferer] = useState<Player | null>(null);
  const [selectedMoveSequence, setSelectedMoveSequence] = useState<Move[]>([]);
  const [legalMoves, setLegalMoves] = useState<Move[][]>([]);
  const [previewState, setPreviewState] = useState<GameState | null>(null);
  const [opponentPreviewMoves, setOpponentPreviewMoves] = useState<Move[]>([]);
  const [showLobby, setShowLobby] = useState(true);
  const [hasTriedAutoJoin, setHasTriedAutoJoin] = useState(false);
  const [timerDisplay, setTimerDisplay] = useState<{
    whiteBankMs: number;
    blackBankMs: number;
    delayRemainingMs: number;
    delayMs: number;
    activePlayer: Player | null;
  } | null>(null);

  const lastWinnerRef = useRef<Player | null>(null);
  const lastAutoPassRef = useRef<string | null>(null);

  const buildPreviewState = useCallback((baseState: GameState, moves: Move[]): GameState => {
    let previewBoard = cloneBoard(baseState.board);
    let previewWhiteOff = baseState.whiteOff;
    let previewBlackOff = baseState.blackOff;
    let previewUnusedDice = [...baseState.unusedDice];

    for (const m of moves) {
      const player = baseState.currentPlayer;
      const fromBoard = m.from === 0 || m.from === 25
        ? m.from
        : playerPointToBoardPoint(m.from, player);
      const toBoard = m.to === -1
        ? -1
        : (m.to === 0 || m.to === 25
          ? m.to
          : playerPointToBoardPoint(m.to, player));

      const dieUsed = m.die;
      const dieIndex = previewUnusedDice.indexOf(dieUsed);
      if (dieIndex >= 0) {
        previewUnusedDice.splice(dieIndex, 1);
      }

      if (toBoard === -1) {
        const fromStack = previewBoard[fromBoard];
        if (fromStack && fromStack.player === player && fromStack.count > 0) {
          fromStack.count--;
          if (fromStack.count === 0) {
            previewBoard[fromBoard] = null;
          }
          if (player === 'white') {
            previewWhiteOff++;
          } else {
            previewBlackOff++;
          }
        }
      } else {
        applyMoveToBoard(previewBoard, fromBoard, toBoard, player);
      }
    }

    return {
      ...baseState,
      board: previewBoard,
      whiteOff: previewWhiteOff,
      blackOff: previewBlackOff,
      unusedDice: previewUnusedDice
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gameIdFromUrl = params.get('game');

    if (gameIdFromUrl && multiplayer.connected && !hasTriedAutoJoin) {
      setHasTriedAutoJoin(true);
      multiplayer.joinGame(gameIdFromUrl);
      setShowLobby(true);
    }
  }, [multiplayer.connected, hasTriedAutoJoin, multiplayer]);

  useEffect(() => {
    multiplayer.onStateUpdate(({ state, match, pendingDoubleOfferer }) => {
      setGameState(state);
      setMatchState(match);
      setPendingDoubleOfferer(pendingDoubleOfferer);
      setShowLobby(false);
      setOpponentPreviewMoves([]);

      if (state.phase === 'moving' && state.currentPlayer === multiplayer.player) {
        setLegalMoves(GameEngine.getLegalMoves(state));
      } else {
        setLegalMoves([]);
      }

      setSelectedMoveSequence([]);
      setPreviewState(null);
    });

    multiplayer.onPreviewUpdate(({ player, moves }) => {
      if (player !== multiplayer.player) {
        setOpponentPreviewMoves(moves);
      }
    });
  }, [multiplayer]);

  const isOurTurn = useMemo(() => {
    if (!gameState || !multiplayer.player) return false;
    return gameState.currentPlayer === multiplayer.player;
  }, [gameState, multiplayer.player]);

  const isOpeningTurn = useMemo(() => {
    if (!gameState) return false;
    return gameState.moveHistory.length === 0 && gameState.phase === 'rolling';
  }, [gameState]);

  const canDoubleByMatchRules = useMemo(() => {
    if (!gameState || !matchState) return true;
    return canDoubleInMatch(
      matchState,
      gameState.currentPlayer,
      gameState.doublingCube.value,
      gameState.doublingCube.owner
    );
  }, [gameState, matchState]);

  const handleRollDice = useCallback(() => {
    if (!gameState || !isOurTurn) return;
    multiplayer.requestRoll();
  }, [gameState, isOurTurn, multiplayer]);

  const handleConfirmMove = useCallback(() => {
    if (!gameState || !isOurTurn) return;
    
    if (selectedMoveSequence.length === 0) {
      if (legalMoves.length === 0) {
        multiplayer.requestMove([]);
        multiplayer.sendPreviewUpdate([]);
      }
      return;
    }

    multiplayer.requestMove(selectedMoveSequence);
    multiplayer.sendPreviewUpdate([]);
  }, [gameState, isOurTurn, selectedMoveSequence, legalMoves, multiplayer]);

  const handleAddMove = useCallback((move: Move) => {
    if (!gameState) return;
    const newSequence = [...selectedMoveSequence, move];
    setSelectedMoveSequence(newSequence);
    multiplayer.sendPreviewUpdate(newSequence);

    setPreviewState(buildPreviewState(gameState, newSequence));
  }, [gameState, selectedMoveSequence, buildPreviewState, multiplayer]);

  const handleSelectMoveSequence = useCallback((moves: Move[]) => {
    if (!gameState) return;
    setSelectedMoveSequence(moves);
    multiplayer.sendPreviewUpdate(moves);
    if (moves.length === 0) {
      setPreviewState(null);
      return;
    }
    setPreviewState(buildPreviewState(gameState, moves));
  }, [gameState, buildPreviewState, multiplayer]);

  const handleUndoMove = useCallback(() => {
    if (!gameState || selectedMoveSequence.length === 0) return;

    const newSequence = selectedMoveSequence.slice(0, -1);
    setSelectedMoveSequence(newSequence);
    multiplayer.sendPreviewUpdate(newSequence);

    if (newSequence.length === 0) {
      setPreviewState(null);
      return;
    }

    setPreviewState(buildPreviewState(gameState, newSequence));
  }, [gameState, selectedMoveSequence, buildPreviewState, multiplayer]);

  const opponentPreviewState = useMemo(() => {
    if (!gameState || opponentPreviewMoves.length === 0) return null;
    return buildPreviewState(gameState, opponentPreviewMoves);
  }, [gameState, opponentPreviewMoves, buildPreviewState]);

  const handleOfferDouble = useCallback(() => {
    multiplayer.offerDouble();
  }, [multiplayer]);

  const handleRespondToDouble = useCallback((accept: boolean) => {
    multiplayer.respondToDouble(accept);
    multiplayer.sendPreviewUpdate([]);
  }, [multiplayer]);

  useEffect(() => {
    if (!multiplayer.timerState) {
      setTimerDisplay(null);
      return;
    }

    const updateTimers = () => {
      const state = multiplayer.timerState!;
      let whiteBankMs = state.whiteBankMs;
      let blackBankMs = state.blackBankMs;
      let delayRemainingMs = state.delayRemainingMs;
      const elapsed = Date.now() - state.clientReceivedAt;

      if (state.activePlayer && elapsed > 0) {
        let remainingElapsed = elapsed;
        if (delayRemainingMs > 0) {
          const delayConsumed = Math.min(remainingElapsed, delayRemainingMs);
          delayRemainingMs -= delayConsumed;
          remainingElapsed -= delayConsumed;
        }

        if (remainingElapsed > 0) {
          if (state.activePlayer === 'white') {
            whiteBankMs = Math.max(0, whiteBankMs - remainingElapsed);
          } else {
            blackBankMs = Math.max(0, blackBankMs - remainingElapsed);
          }
        }
      }

      setTimerDisplay({
        whiteBankMs,
        blackBankMs,
        delayRemainingMs,
        delayMs: state.delayMs,
        activePlayer: state.activePlayer
      });
    };

    updateTimers();
    const interval = setInterval(updateTimers, 100);
    return () => clearInterval(interval);
  }, [multiplayer.timerState]);

  useEffect(() => {
    if (!multiplayer.timeoutResult) return;
    const { winner, loser } = multiplayer.timeoutResult;
    alert(`${winner} wins on time. ${loser} ran out of time.`);
    multiplayer.clearTimeoutResult();
  }, [multiplayer]);

  useEffect(() => {
    if (!gameState || !gameState.winner) return;
    if (lastWinnerRef.current === gameState.winner) return;
    lastWinnerRef.current = gameState.winner;
    const winTypeText = gameState.winType === 'normal'
      ? ''
      : gameState.winType === 'gammon'
        ? ' (Gammon)'
        : ' (Backgammon)';
    const points = gameState.pointsAwarded || 1;
    alert(`${gameState.winner} wins${winTypeText}! +${points} point${points !== 1 ? 's' : ''}`);
  }, [gameState]);

  useEffect(() => {
    if (!gameState || !matchState) return;
    if (gameState.variant !== 'asymmetric') return;
    if (!isOurTurn) return;
    if (pendingDoubleOfferer) return;
    if (gameState.phase !== 'moving') return;
    if (legalMoves.length > 0) return;

    const dice = gameState.currentPlayer === 'white' ? gameState.whiteDice : gameState.blackDice;
    const diceKey = dice ? `${dice.die1}-${dice.die2}` : 'none';
    const key = `${gameState.currentPlayer}|${gameState.moveHistory.length}|${diceKey}`;
    if (lastAutoPassRef.current === key) return;
    lastAutoPassRef.current = key;

    multiplayer.requestMove([]);
    multiplayer.sendPreviewUpdate([]);
  }, [gameState, matchState, isOurTurn, pendingDoubleOfferer, legalMoves, multiplayer]);

  // Keyboard shortcuts (spacebar for roll/confirm)
  useEffect(() => {
    if (!gameState) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (gameState.phase === 'rolling') {
          handleRollDice();
        } else if (gameState.phase === 'moving') {
          if (selectedMoveSequence.length > 0 || legalMoves.length === 0) {
            handleConfirmMove();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [gameState, selectedMoveSequence, legalMoves, handleRollDice, handleConfirmMove]);

  if (showLobby || !gameState || !matchState) {
    return <MultiplayerLobby onGameStart={() => setShowLobby(false)} />;
  }

  const doubleOffered = pendingDoubleOfferer !== null;

  return (
    <div className="app">
      <div className="app-header">
        <h1 className="app-title">Backgammon</h1>
        <div className="match-info">
          {multiplayer.player && (
            <div className="player-badge">You: {multiplayer.player}</div>
          )}
          <div className="match-score">
            <span className="score-white">{matchState.score.white}</span>
            <span className="score-separator">-</span>
            <span className="score-black">{matchState.score.black}</span>
            {matchState.config.type === 'limited' && matchState.config.targetScore && (
              <span className="score-target"> (to {matchState.config.targetScore})</span>
            )}
          </div>
          <div className="game-number">
            Game #{matchState.currentGame}
            {matchState.crawfordGame && <span className="crawford-indicator"> (Crawford)</span>}
          </div>
        </div>
        {gameState.variant === 'asymmetric' && (
          <div className="variant-badge">Asymmetric Variant</div>
        )}
      </div>

      <div className="app-content">
        <Sidebar
          gameState={gameState}
          onStartGame={(_variant) => {}}
          hideSetup={true}
        />

        <div className="game-area">
          {timerDisplay && (
            <TimePanel
              whiteBankMs={timerDisplay.whiteBankMs}
              blackBankMs={timerDisplay.blackBankMs}
              delayRemainingMs={timerDisplay.delayRemainingMs}
              delayMs={timerDisplay.delayMs}
              activePlayer={timerDisplay.activePlayer}
              playerPerspective={multiplayer.player}
            />
          )}
          <Board
            gameState={previewState || opponentPreviewState || gameState}
            baseGameState={gameState}
            legalMoves={legalMoves}
            selectedMoveSequence={selectedMoveSequence}
            doubleOffered={doubleOffered}
            isFirstTurn={isOpeningTurn}
            playerPerspective={multiplayer.player}
            canDouble={canDoubleByMatchRules}
            crawfordGame={matchState.crawfordGame}
            onAddMove={handleAddMove}
            onSelectMoveSequence={handleSelectMoveSequence}
            onExecuteMove={handleConfirmMove}
            onUndoMove={handleUndoMove}
            onRollDice={handleRollDice}
            onOfferDouble={handleOfferDouble}
            onRespondToDouble={handleRespondToDouble}
            opponentPreviewMoves={opponentPreviewMoves}
          />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <MultiplayerProvider>
      <GameApp />
    </MultiplayerProvider>
  );
}
