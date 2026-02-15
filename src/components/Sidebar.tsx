import React, { useState } from 'react';
import { GameState, Player } from '../engine/types';
import './Sidebar.css';

interface SidebarProps {
  gameState: GameState;
  onStartGame: (variant: 'standard' | 'asymmetric') => void;
  hideSetup?: boolean; // Hide game setup section (for multiplayer matches)
}

const Sidebar: React.FC<SidebarProps> = ({ gameState, onStartGame, hideSetup = false }) => {
  const [showRules, setShowRules] = useState(false);
  const asymmetricPlayers: Player[] = ['white', 'black'];
  const hasDoublingRole = Boolean(
    gameState.asymmetricRoles &&
    asymmetricPlayers.some((player) => gameState.asymmetricRoles?.[player] === 'doubling')
  );

  return (
    <div className="sidebar">
      {!hideSetup && (
        <div className="sidebar-section">
          <h2 className="sidebar-title">Game Setup</h2>
        <div className="variant-buttons">
          <button
            className={`btn btn-variant ${
              gameState.variant === 'standard' ? 'btn-variant-active' : ''
            }`}
            onClick={() => onStartGame('standard')}
          >
            Standard Game
          </button>
          <button
            className={`btn btn-variant ${
              gameState.variant === 'asymmetric' ? 'btn-variant-active' : ''
            }`}
            onClick={() => onStartGame('asymmetric')}
          >
            Asymmetric Variant
          </button>
        </div>
      </div>
      )}

      {gameState.asymmetricRoles && (
        <div className="sidebar-section roles-section">
          <h3 className="sidebar-subtitle">Player Roles</h3>
          <div className="role-info">
            {asymmetricPlayers.map((rolePlayer) => {
              const role = gameState.asymmetricRoles?.[rolePlayer] || 'foresight';
              const roleLabel = role === 'foresight' ? '👁️ Foresight' : '×2 Doubling';
              const roleDescription = role === 'foresight'
                ? 'Sees opponent pre-rolls and can roll ahead in foresight mirrors.'
                : 'Owns the doubling cube and can offer doubles on moving turns.';
              return (
                <div key={rolePlayer} className={`role-card role-${rolePlayer}`}>
                  <div className="role-title">{roleLabel} Role</div>
                  <div className="role-player">
                    {rolePlayer.toUpperCase()}
                  </div>
                  <div className="role-description">{roleDescription}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="sidebar-section">
        <h3 className="sidebar-subtitle">Game Info</h3>
        <div className="info-grid">
          <div className="info-item">
            <span className="info-label">Phase:</span>
            <span className="info-value">{gameState.phase}</span>
          </div>
          <div className="info-item">
            <span className="info-label">Stakes:</span>
            <span className="info-value">{gameState.stakes}</span>
          </div>
          <div className="info-item">
            <span className="info-label">Moves:</span>
            <span className="info-value">{gameState.moveHistory.length}</span>
          </div>
        </div>
      </div>

      <div className="sidebar-section">
        <h3 className="sidebar-subtitle">Checkers</h3>
        <div className="checkers-info">
          <div className="checker-status">
            <div className="checker-status-label">
              <div className="checker-dot checker-white" />
              White
            </div>
            <div className="checker-status-value">
              {15 - gameState.whiteOff} on board, {gameState.whiteOff} off
            </div>
          </div>
          <div className="checker-status">
            <div className="checker-status-label">
              <div className="checker-dot checker-black" />
              Black
            </div>
            <div className="checker-status-value">
              {15 - gameState.blackOff} on board, {gameState.blackOff} off
            </div>
          </div>
        </div>
      </div>

      <div className="sidebar-section">
        <button
          className="btn btn-secondary btn-rules"
          onClick={() => setShowRules(!showRules)}
        >
          {showRules ? '✕ Hide Rules' : '📖 Show Rules'}
        </button>

        {showRules && (
          <div className="rules-content">
            {gameState.variant === 'asymmetric' ? (
              <>
                <h4>Asymmetric Variant</h4>
                <p><strong>Foresight Player:</strong></p>
                <ul>
                  <li>Sees opponent dice before moving.</li>
                  <li>In Foresight vs Doubling, the foresight player rolls for both players.</li>
                  <li>In Foresight vs Foresight, the opening roll sets both players; then each player rolls the opponent&apos;s next turn.</li>
                </ul>
                <p><strong>Doubling Player:</strong></p>
                <ul>
                  <li>Owns the doubling cube for the whole game.</li>
                  <li>Can offer doubles at the start of moving turns.</li>
                </ul>
                {!hasDoublingRole && (
                  <p><strong>Foresight vs Foresight:</strong> doubling follows standard cube ownership rules.</p>
                )}
              </>
            ) : (
              <>
                <h4>Standard Backgammon</h4>
                <ul>
                  <li>Move all 15 checkers to your home board</li>
                  <li>Then bear them off</li>
                  <li>First to bear off all checkers wins</li>
                  <li>Use doubling cube to raise stakes</li>
                </ul>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default React.memo(Sidebar);
