import React, { useState } from 'react';
import { GameState } from '../engine/types';
import './Sidebar.css';

interface SidebarProps {
  gameState: GameState;
  onStartGame: (variant: 'standard' | 'asymmetric') => void;
  hideSetup?: boolean; // Hide game setup section (for multiplayer matches)
}

const Sidebar: React.FC<SidebarProps> = ({ gameState, onStartGame, hideSetup = false }) => {
  const [showRules, setShowRules] = useState(false);

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
            <div className={`role-card role-${gameState.asymmetricRoles.foresightPlayer}`}>
              <div className="role-title">👁️ Foresight Player</div>
              <div className="role-player">
                {gameState.asymmetricRoles.foresightPlayer.toUpperCase()}
              </div>
              <div className="role-description">
                Rolls both dice sets. Sees opponent's roll before moving.
              </div>
            </div>
            <div className={`role-card role-${gameState.asymmetricRoles.doublingPlayer}`}>
              <div className="role-title">×2 Doubling Player</div>
              <div className="role-player">
                {gameState.asymmetricRoles.doublingPlayer.toUpperCase()}
              </div>
              <div className="role-description">
                Always owns the cube. Can double anytime.
              </div>
            </div>
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
                  <li>Rolls two sets of dice each turn</li>
                  <li>Sees opponent's dice before moving</li>
                  <li>Cannot use the doubling cube</li>
                </ul>
                <p><strong>Doubling Player:</strong></p>
                <ul>
                  <li>Always owns the doubling cube</li>
                  <li>Can double at any time</li>
                  <li>Uses pre-rolled dice</li>
                </ul>
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
