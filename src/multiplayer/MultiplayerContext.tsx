import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { GameState, Move } from '../engine/types';
import { MatchState } from '../engine/match';

type Player = 'white' | 'black';

interface TimeControl {
  perPointMs: number;
  unlimitedMs: number;
  delayMs: number;
}

interface TimerState {
  whiteBankMs: number;
  blackBankMs: number;
  delayRemainingMs: number;
  delayMs: number;
  activePlayer: Player | null;
  serverNow: number;
  clientReceivedAt: number;
}

interface GameUpdate {
  state: GameState;
  match: MatchState;
  pendingDoubleOfferer: Player | null;
}

interface MultiplayerContextType {
  connected: boolean;
  gameId: string | null;
  player: Player | null;
  opponentConnected: boolean;
  matchType: 'limited' | 'unlimited' | null;
  targetScore: number | null;
  variant: 'standard' | 'asymmetric' | null;
  timeControl: TimeControl | null;
  timerState: TimerState | null;
  timeoutResult: { winner: Player; loser: Player } | null;
  clearTimeoutResult: () => void;
  createGame: (
    variant: 'standard' | 'asymmetric',
    matchType: 'limited' | 'unlimited',
    targetScore?: number,
    timeControl?: TimeControl,
    vsBot?: boolean
  ) => void;
  joinGame: (gameId: string) => void;
  leaveGame: () => void;
  requestRoll: () => void;
  requestMove: (moves: Move[]) => void;
  offerDouble: () => void;
  respondToDouble: (accept: boolean) => void;
  sendPreviewUpdate: (moves: Move[]) => void;
  onStateUpdate: (callback: (update: GameUpdate) => void) => void;
  onPreviewUpdate: (callback: (payload: { player: Player; moves: Move[] }) => void) => void;
}

const MultiplayerContext = createContext<MultiplayerContextType | null>(null);

export function MultiplayerProvider({ children }: { children: React.ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [gameId, setGameId] = useState<string | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [opponentConnected, setOpponentConnected] = useState(false);
  const [matchType, setMatchType] = useState<'limited' | 'unlimited' | null>(null);
  const [targetScore, setTargetScore] = useState<number | null>(null);
  const [variant, setVariant] = useState<'standard' | 'asymmetric' | null>(null);
  const [timeControl, setTimeControl] = useState<TimeControl | null>(null);
  const [timerState, setTimerState] = useState<TimerState | null>(null);
  const [timeoutResult, setTimeoutResult] = useState<{ winner: Player; loser: Player } | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const stateCallbackRef = useRef<((update: GameUpdate) => void) | null>(null);
  const previewCallbackRef = useRef<((payload: { player: Player; moves: Move[] }) => void) | null>(null);

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const envUrl = (import.meta as any).env?.VITE_WS_URL as string | undefined;
    const wsUrl = envUrl || `${protocol}://${window.location.hostname}:8080`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      setGameId(null);
      setPlayer(null);
      setOpponentConnected(false);
      setTimeControl(null);
      setTimerState(null);
      setTimeoutResult(null);
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handleMessage(message);
      } catch (error) {
        console.error('Error parsing message:', error);
      }
    };

    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    };
  }, []);

  const handleMessage = useCallback((message: any) => {
    switch (message.type) {
      case 'GAME_CREATED':
        setGameId(message.gameId);
        setPlayer(message.player);
        setOpponentConnected(false);
        setVariant(message.variant);
        setMatchType(message.matchType);
        setTargetScore(message.targetScore || null);
        setTimeControl(message.timeControl || null);
        break;
      case 'GAME_JOINED':
        setGameId(message.gameId);
        setPlayer(message.player);
        setOpponentConnected(true);
        setVariant(message.variant);
        setMatchType(message.matchType);
        setTargetScore(message.targetScore || null);
        setTimeControl(message.timeControl || null);
        break;
      case 'PLAYER_JOINED':
        setOpponentConnected(true);
        break;
      case 'STATE_UPDATE':
        if (stateCallbackRef.current) {
          stateCallbackRef.current({
            state: message.state,
            match: message.match,
            pendingDoubleOfferer: message.pendingDoubleOfferer || null
          });
        }
        break;
      case 'PREVIEW_UPDATE':
        if (previewCallbackRef.current) {
          previewCallbackRef.current({
            player: message.player,
            moves: Array.isArray(message.moves) ? message.moves : []
          });
        }
        break;
      case 'TIMER_UPDATE':
        setTimerState({
          ...message.timers,
          clientReceivedAt: Date.now()
        });
        break;
      case 'TIMEOUT':
        setTimeoutResult({ winner: message.winner, loser: message.loser });
        break;
      case 'PLAYER_DISCONNECTED':
      case 'PLAYER_LEFT':
        setOpponentConnected(false);
        alert(`Opponent ${message.type === 'PLAYER_DISCONNECTED' ? 'disconnected' : 'left'}`);
        break;
      case 'ERROR':
        console.error('Server error:', message.error);
        alert(`Error: ${message.error}`);
        break;
    }
  }, []);

  const sendMessage = useCallback((payload: Record<string, any>) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify(payload));
  }, []);

  const createGame = useCallback((
    variant: 'standard' | 'asymmetric',
    matchType: 'limited' | 'unlimited',
    targetScore?: number,
    timeControlOverride?: TimeControl,
    vsBot?: boolean
  ) => {
    sendMessage({
      type: 'CREATE_GAME',
      variant,
      matchType,
      targetScore,
      timeControl: timeControlOverride,
      vsBot: Boolean(vsBot)
    });
  }, [sendMessage]);

  const joinGame = useCallback((joinId: string) => {
    sendMessage({ type: 'JOIN_GAME', gameId: joinId });
  }, [sendMessage]);

  const leaveGame = useCallback(() => {
    if (!gameId) return;
    sendMessage({ type: 'LEAVE_GAME', gameId });
    setGameId(null);
    setPlayer(null);
    setOpponentConnected(false);
  }, [sendMessage, gameId]);

  const requestRoll = useCallback(() => {
    if (!gameId) return;
    sendMessage({ type: 'ROLL_REQUEST', gameId });
  }, [sendMessage, gameId]);

  const requestMove = useCallback((moves: Move[]) => {
    if (!gameId) return;
    sendMessage({ type: 'MOVE_REQUEST', gameId, moves });
  }, [sendMessage, gameId]);

  const offerDouble = useCallback(() => {
    if (!gameId) return;
    sendMessage({ type: 'DOUBLE_OFFER', gameId });
  }, [sendMessage, gameId]);

  const respondToDouble = useCallback((accept: boolean) => {
    if (!gameId) return;
    sendMessage({ type: 'DOUBLE_RESPONSE', gameId, accepted: accept });
  }, [sendMessage, gameId]);

  const sendPreviewUpdate = useCallback((moves: Move[]) => {
    if (!gameId) return;
    sendMessage({ type: 'PREVIEW_UPDATE', gameId, moves });
  }, [sendMessage, gameId]);

  const onStateUpdate = useCallback((callback: (update: GameUpdate) => void) => {
    stateCallbackRef.current = callback;
  }, []);

  const onPreviewUpdate = useCallback((callback: (payload: { player: Player; moves: Move[] }) => void) => {
    previewCallbackRef.current = callback;
  }, []);

  const value: MultiplayerContextType = {
    connected,
    gameId,
    player,
    opponentConnected,
    matchType,
    targetScore,
    variant,
    timeControl,
    timerState,
    timeoutResult,
    clearTimeoutResult: () => setTimeoutResult(null),
    createGame,
    joinGame,
    leaveGame,
    requestRoll,
    requestMove,
    offerDouble,
    respondToDouble,
    sendPreviewUpdate,
    onStateUpdate,
    onPreviewUpdate
  };

  return (
    <MultiplayerContext.Provider value={value}>
      {children}
    </MultiplayerContext.Provider>
  );
}

export function useMultiplayer() {
  const context = useContext(MultiplayerContext);
  if (!context) {
    throw new Error('useMultiplayer must be used within MultiplayerProvider');
  }
  return context;
}
