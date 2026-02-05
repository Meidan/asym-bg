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
  matchScore: { white: number; black: number };
  matchType: 'limited' | 'unlimited';
  targetScore?: number | null;
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
  playerPerspective,
  matchScore,
  matchType,
  targetScore
}) => {
  const topPlayer: Player = playerPerspective === 'black' ? 'white' : 'black';
  const bottomPlayer: Player = playerPerspective === 'black' ? 'black' : 'white';

  const topBank = topPlayer === 'white' ? whiteBankMs : blackBankMs;
  const bottomBank = bottomPlayer === 'white' ? whiteBankMs : blackBankMs;
  const topScore = topPlayer === 'white' ? matchScore.white : matchScore.black;
  const bottomScore = bottomPlayer === 'white' ? matchScore.white : matchScore.black;
  const matchSuffix = matchType === 'limited'
    ? (targetScore ? `to ${targetScore}` : 'limited')
    : 'unlimited';
  const topScoreClass = topPlayer === 'white' ? 'score-white' : 'score-black';
  const bottomScoreClass = bottomPlayer === 'white' ? 'score-white' : 'score-black';

  return (
    <div className="time-panel">
      <div className="timer-stack timer-stack-top">
        <div className={`match-score-display score-top ${topScoreClass}`}>
          <span className="match-score-value">{topScore}</span>
          <span className="match-score-meta">({matchSuffix})</span>
        </div>
        <div className={`timer-card timer-top ${activePlayer === topPlayer ? 'timer-active' : ''}`}>
          <div className="timer-label">{topPlayer.toUpperCase()}</div>
          <div className="timer-value">{formatBank(topBank)}</div>
        </div>
      </div>

      <div className="timer-delay">
        <div className="timer-delay-label">Delay</div>
        <div className="timer-delay-value">
          {activePlayer ? `${formatDelay(delayRemainingMs)}s` : `${formatDelay(delayMs)}s`}
        </div>
      </div>

      <div className="timer-stack timer-stack-bottom">
        <div className={`timer-card timer-bottom ${activePlayer === bottomPlayer ? 'timer-active' : ''}`}>
          <div className="timer-label">{bottomPlayer.toUpperCase()}</div>
          <div className="timer-value">{formatBank(bottomBank)}</div>
        </div>
        <div className={`match-score-display score-bottom ${bottomScoreClass}`}>
          <span className="match-score-value">{bottomScore}</span>
          <span className="match-score-meta">({matchSuffix})</span>
        </div>
      </div>
    </div>
  );
};

export default TimePanel;
