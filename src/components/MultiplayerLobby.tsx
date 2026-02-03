import React, { useState } from 'react';
import { useMultiplayer } from '../multiplayer/MultiplayerContext';
import './MultiplayerLobby.css';

interface MultiplayerLobbyProps {
  onGameStart: () => void;
}

export default function MultiplayerLobby({ onGameStart }: MultiplayerLobbyProps) {
  const { 
    connected, 
    gameId, 
    player,
    opponentConnected,
    createGame, 
    joinGame 
  } = useMultiplayer();
  
  const [joinGameId, setJoinGameId] = useState('');
  const [selectedVariant, setSelectedVariant] = useState<'standard' | 'asymmetric'>('standard');
  const [matchType, setMatchType] = useState<'limited' | 'unlimited'>('unlimited');
  const [targetScore, setTargetScore] = useState(5);
  const [minutesPerPoint, setMinutesPerPoint] = useState(1);
  const [unlimitedMinutes, setUnlimitedMinutes] = useState(1);
  const [delaySeconds, setDelaySeconds] = useState(5);
  const [playVsBot, setPlayVsBot] = useState(false);
  
  const handleCreateGame = () => {
    const timeControl = {
      perPointMs: Math.max(0.1, minutesPerPoint) * 60_000,
      unlimitedMs: Math.max(0.1, unlimitedMinutes) * 60_000,
      delayMs: Math.max(0, delaySeconds) * 1_000
    };
    createGame(
      selectedVariant,
      matchType,
      matchType === 'limited' ? targetScore : undefined,
      timeControl,
      playVsBot
    );
  };
  
  const handleJoinGame = () => {
    if (joinGameId.trim()) {
      joinGame(joinGameId.trim());
    }
  };
  
  const handleCopyLink = () => {
    if (gameId) {
      const link = `${window.location.origin}?game=${gameId}`;
      navigator.clipboard.writeText(link);
      alert('Game link copied to clipboard!');
    }
  };
  
  // Auto-start game when opponent connects
  React.useEffect(() => {
    if (opponentConnected && gameId) {
      onGameStart();
    }
  }, [opponentConnected, gameId, onGameStart]);
  
  if (!connected) {
    return (
      <div className="multiplayer-lobby">
        <div className="lobby-content">
          <div className="loading-spinner"></div>
          <p>Connecting to server...</p>
        </div>
      </div>
    );
  }
  
  if (gameId && !opponentConnected) {
    return (
      <div className="multiplayer-lobby">
        <div className="lobby-content">
          <h2>Waiting for Opponent</h2>
          <p className="player-info">You are playing as: <strong>{player}</strong></p>
          
          <div className="game-link-container">
            <div className="game-link">
              <span className="link-label">Game Link:</span>
              <code>{`${window.location.origin}?game=${gameId}`}</code>
            </div>
            <button className="btn btn-primary" onClick={handleCopyLink}>
              📋 Copy Link
            </button>
          </div>
          
          <div className="waiting-animation">
            <div className="dot"></div>
            <div className="dot"></div>
            <div className="dot"></div>
          </div>
          
          <p className="instruction">Share this link with your opponent to start the game!</p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="multiplayer-lobby">
      <div className="lobby-content">
        <h1>Multiplayer Backgammon</h1>
        
        <div className="lobby-section">
          <h2>Create New Game</h2>
          
          <div className="setting-group">
            <label className="setting-label">Game Variant:</label>
            <div className="variant-selector">
              <label className="radio-label">
                <input 
                  type="radio" 
                  value="standard"
                  checked={selectedVariant === 'standard'}
                  onChange={(e) => setSelectedVariant('standard')}
                />
                <span>Standard</span>
              </label>
              <label className="radio-label">
                <input 
                  type="radio" 
                  value="asymmetric"
                  checked={selectedVariant === 'asymmetric'}
                  onChange={(e) => setSelectedVariant('asymmetric')}
                />
                <span>Asymmetric</span>
              </label>
            </div>
          </div>
          
          <div className="setting-group">
            <label className="setting-label">Match Type:</label>
            <div className="variant-selector">
              <label className="radio-label">
                <input 
                  type="radio" 
                  value="unlimited"
                  checked={matchType === 'unlimited'}
                  onChange={(e) => setMatchType('unlimited')}
                />
                <span>Unlimited</span>
              </label>
              <label className="radio-label">
                <input 
                  type="radio" 
                  value="limited"
                  checked={matchType === 'limited'}
                  onChange={(e) => setMatchType('limited')}
                />
                <span>First to:</span>
              </label>
              {matchType === 'limited' && (
                <select 
                  className="score-select"
                  value={targetScore}
                  onChange={(e) => setTargetScore(Number(e.target.value))}
                >
                  <option value={1}>1</option>
                  <option value={3}>3</option>
                  <option value={5}>5</option>
                  <option value={7}>7</option>
                  <option value={9}>9</option>
                </select>
              )}
            </div>
          </div>

          <div className="setting-group">
            <label className="setting-label">Clock Settings:</label>
            <div className="variant-selector">
              <label className="radio-label">
                <span>Minutes per match point</span>
                <input 
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={minutesPerPoint}
                  onChange={(e) => setMinutesPerPoint(Number(e.target.value))}
                />
              </label>
              <label className="radio-label">
                <span>Minutes in unlimited</span>
                <input 
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={unlimitedMinutes}
                  onChange={(e) => setUnlimitedMinutes(Number(e.target.value))}
                />
              </label>
              <label className="radio-label">
                <span>Delay seconds per turn</span>
                <input 
                  type="number"
                  min={0}
                  step={0.5}
                  value={delaySeconds}
                  onChange={(e) => setDelaySeconds(Number(e.target.value))}
                />
              </label>
            </div>
          </div>
          
          <div className="setting-group">
            <label className="setting-label">Opponent:</label>
            <div className="variant-selector">
              <label className="radio-label">
                <input
                  type="checkbox"
                  checked={playVsBot}
                  onChange={(e) => setPlayVsBot(e.target.checked)}
                />
                <span>Play vs bot (bot is black)</span>
              </label>
            </div>
          </div>
          
          <button className="btn btn-primary btn-large" onClick={handleCreateGame}>
            Create Game
          </button>
        </div>
        
        <div className="lobby-divider">OR</div>
        
        <div className="lobby-section">
          <h2>Join Existing Game</h2>
          
          <input 
            type="text" 
            className="game-id-input"
            placeholder="Enter game ID"
            value={joinGameId}
            onChange={(e) => setJoinGameId(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleJoinGame()}
          />
          
          <button 
            className="btn btn-secondary btn-large" 
            onClick={handleJoinGame}
            disabled={!joinGameId.trim()}
          >
            Join Game
          </button>
        </div>
      </div>
    </div>
  );
}
