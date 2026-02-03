import React from 'react';
import { Player } from '../engine/types';
import './Checker.css';

interface CheckerProps {
  player: Player;
  position: number; // Position in stack (0 = bottom)
  total: number; // Total checkers in stack
  isClickable: boolean;
  onClick: (useLowest: boolean) => void;
}

const Checker: React.FC<CheckerProps> = ({
  player,
  position,
  total,
  isClickable,
  onClick
}) => {
  const handleClick = (e: React.MouseEvent) => {
    if (!isClickable) return;
    e.preventDefault();
    onClick(false); // Left click = use highest die
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    if (!isClickable) return;
    e.preventDefault();
    onClick(true); // Right click = use lowest die
  };

  return (
    <div
      className={`checker checker-${player} ${isClickable ? 'checker-clickable' : ''}`}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      style={{
        '--stack-position': position
      } as React.CSSProperties}
    >
      <div className="checker-inner" />
    </div>
  );
};

export default Checker;
