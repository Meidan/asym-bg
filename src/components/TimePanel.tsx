import React from 'react';
import './TimePanel.css';

type Player = 'white' | 'black';

interface TimePanelProps {
  whiteBankMs: number;
  blackBankMs: number;
  delayRemainingMs: number;
  delayMs: number;
  activePlayer: Player | null;
  playerPerspective: Player | null;
}

function formatBank(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function formatDelay(ms: number): string {
  const seconds = Math.max(0, ms / 1000);
  return seconds.toFixed(1);
}

const TimePanel: React.FC<TimePanelProps> = ({
  whiteBankMs,
  blackBankMs,
  delayRemainingMs,
  delayMs,
  activePlayer,
  playerPerspective
}) => {
  const topPlayer: Player = playerPerspective === 'black' ? 'white' : 'black';
  const bottomPlayer: Player = playerPerspective === 'black' ? 'black' : 'white';

  const topBank = topPlayer === 'white' ? whiteBankMs : blackBankMs;
  const bottomBank = bottomPlayer === 'white' ? whiteBankMs : blackBankMs;

  return (
    <div className="time-panel">
      <div className={`timer-card timer-top ${activePlayer === topPlayer ? 'timer-active' : ''}`}>
        <div className="timer-label">{topPlayer.toUpperCase()}</div>
        <div className="timer-value">{formatBank(topBank)}</div>
      </div>

      <div className="timer-delay">
        <div className="timer-delay-label">Delay</div>
        <div className="timer-delay-value">
          {activePlayer ? `${formatDelay(delayRemainingMs)}s` : `${formatDelay(delayMs)}s`}
        </div>
      </div>

      <div className={`timer-card timer-bottom ${activePlayer === bottomPlayer ? 'timer-active' : ''}`}>
        <div className="timer-label">{bottomPlayer.toUpperCase()}</div>
        <div className="timer-value">{formatBank(bottomBank)}</div>
      </div>
    </div>
  );
};

export default TimePanel;
