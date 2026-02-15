import {
  AsymmetricRoles,
  AsymmetricRolesConfig,
  GameState,
  Player,
  getSingleAsymmetricRolePlayer,
  isValidAsymmetricRoles,
  normalizeAsymmetricRoles,
  playerHasAsymmetricRole,
  randomAsymmetricRoles
} from './types';

export type MatchType = 'limited' | 'unlimited';

export interface MatchConfig {
  type: MatchType;
  targetScore?: number; // For limited matches (1, 3, 5, 7, 9)
  variant: 'standard' | 'asymmetric';
  asymmetricRoles?: AsymmetricRolesConfig;
}

export interface MatchScore {
  white: number;
  black: number;
}

export interface MatchState {
  config: MatchConfig;
  score: MatchScore;
  currentGame: number; // Game number in the match
  winner: Player | null; // Winner of the match (if completed)
  crawfordGame: boolean; // True if this is the Crawford game
  postCrawford: boolean; // True if we're past the Crawford game
  asymmetricRoles?: AsymmetricRoles;
}

export function createMatch(config: MatchConfig): MatchState {
  const normalizedRoles = normalizeAsymmetricRoles(config.asymmetricRoles);
  const roles = config.variant === 'asymmetric'
    ? normalizedRoles || randomAsymmetricRoles()
    : undefined;
  if (roles && !isValidAsymmetricRoles(roles)) {
    throw new Error('Invalid asymmetric roles: Doubling vs Doubling is not allowed');
  }
  return {
    config,
    score: { white: 0, black: 0 },
    currentGame: 1,
    winner: null,
    crawfordGame: false,
    postCrawford: false,
    asymmetricRoles: roles
  };
}

export function updateMatchScore(
  match: MatchState, 
  winner: Player, 
  points: number
): MatchState {
  const newScore = {
    white: match.score.white + (winner === 'white' ? points : 0),
    black: match.score.black + (winner === 'black' ? points : 0)
  };
  
  // Check if match is won
  let matchWinner: Player | null = null;
  if (match.config.type === 'limited' && match.config.targetScore) {
    if (newScore.white >= match.config.targetScore) {
      matchWinner = 'white';
    } else if (newScore.black >= match.config.targetScore) {
      matchWinner = 'black';
    }
  }
  
  // Check if we should enter Crawford game
  let crawfordGame = false;
  let postCrawford = match.postCrawford;
  
  if (match.config.type === 'limited' && match.config.targetScore && !matchWinner) {
    // If one player is 1 away from winning and we haven't had Crawford yet
    const whiteNeedsOne = newScore.white === match.config.targetScore - 1;
    const blackNeedsOne = newScore.black === match.config.targetScore - 1;
    
    if ((whiteNeedsOne || blackNeedsOne) && !match.crawfordGame && !match.postCrawford) {
      // This is the Crawford game
      crawfordGame = true;
    } else if (match.crawfordGame) {
      // We just finished Crawford game
      postCrawford = true;
    }
  }
  
  return {
    ...match,
    score: newScore,
    currentGame: match.currentGame + 1,
    winner: matchWinner,
    crawfordGame,
    postCrawford,
    asymmetricRoles: match.asymmetricRoles
  };
}

/**
 * Check if a player can double in the current match situation
 */
export function canDoubleInMatch(
  match: MatchState,
  currentPlayer: Player,
  cubeValue: number,
  cubeOwner: Player | null
): boolean {
  // In unlimited matches, normal doubling rules apply
  if (match.config.type === 'unlimited') {
    return cubeOwner === null || cubeOwner === currentPlayer;
  }
  
  // Crawford game: no doubling allowed
  if (match.crawfordGame) {
    return false;
  }
  
  const targetScore = match.config.targetScore!;
  const currentScore = match.score[currentPlayer];
  
  // If we're already at or past match point with current cube, can't double
  // This prevents doubling when you're guaranteed to win the match
  if (currentScore + cubeValue >= targetScore) {
    return false;
  }
  
  // Normal cube ownership check
  return cubeOwner === null || cubeOwner === currentPlayer;
}

export function canOfferDoubleNow(
  match: MatchState,
  state: GameState,
  currentPlayer: Player
): boolean {
  if (state.moveHistory.length === 0) return false;
  if (state.doublingCube.value >= 64) return false;

  const matchAllows = canDoubleInMatch(
    match,
    currentPlayer,
    state.doublingCube.value,
    state.doublingCube.owner
  );
  if (!matchAllows) return false;

  if (state.variant === 'asymmetric') {
    if (!state.asymmetricRoles) return false;

    const fixedDoublingPlayer = getSingleAsymmetricRolePlayer(state.asymmetricRoles, 'doubling');
    if (fixedDoublingPlayer) {
      if (!playerHasAsymmetricRole(state.asymmetricRoles, currentPlayer, 'doubling')) return false;
    } else {
      // Foresight vs Foresight: standard cube ownership, but in moving phase.
      if (state.doublingCube.owner !== null && state.doublingCube.owner !== currentPlayer) return false;
    }

    if (state.doubleOfferedThisTurn) return false;
    return state.phase === 'moving';
  }

  if (state.phase !== 'rolling') return false;
  return state.doublingCube.owner === null || state.doublingCube.owner === currentPlayer;
}

export function getMatchLeader(match: MatchState): { leader: Player | null; difference: number } {
  const diff = match.score.white - match.score.black;
  
  if (diff > 0) {
    return { leader: 'white', difference: diff };
  } else if (diff < 0) {
    return { leader: 'black', difference: Math.abs(diff) };
  } else {
    return { leader: null, difference: 0 };
  }
}

export function formatMatchScore(match: MatchState): string {
  const { white, black } = match.score;
  if (match.config.type === 'limited') {
    return `${white}-${black} (to ${match.config.targetScore})`;
  } else {
    return `${white}-${black}`;
  }
}
