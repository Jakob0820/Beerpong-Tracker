export type ThrowType = 'hit' | 'bounce' | 'bomb';
export type Phase = 'setup' | 'group' | 'ko' | 'done';
export type MatchStatus = 'pending' | 'live' | 'done';
/**
 * Abschnitt eines laufenden Spiels: 'decide' = ein Team hat alle Becher getroffen und es wird gefragt,
 * ob der Gegner eine Redemption bekommt; 'redemption' = der Gegner wirft, bis er verfehlt;
 * 'sudden' = beide haben alle Becher getroffen, der nächste Treffer gewinnt;
 * 'confirm' = im Sudden Death wurde getroffen, der Sieg muss am Tisch noch bestätigt werden.
 */
export type MatchStage = 'normal' | 'decide' | 'redemption' | 'sudden' | 'confirm';

export interface Settings {
  cupsToWin: number;
  tables: number;
  advancePerGroup: number;
  autoAssign: boolean;
  cupsBounce: number;
}

export interface PlayerRef {
  id: number;
  name: string;
}

export interface TeamView {
  id: number;
  name: string;
  group: string | null;
  players: PlayerRef[];
}

export interface MatchView {
  id: number;
  phase: 'group' | 'ko';
  round: number;
  slot: number;
  group: string | null;
  label: string;
  teamAId: number | null;
  teamBId: number | null;
  tableNo: number | null;
  status: MatchStatus;
  stage: MatchStage;
  winnerTeamId: number | null;
  scoreA: number;
  scoreB: number;
  isBye: boolean;
}

export interface StandingRow {
  teamId: number;
  played: number;
  wins: number;
  losses: number;
  cupsFor: number;
  cupsAgainst: number;
  diff: number;
}

export interface GroupTable {
  name: string;
  rows: StandingRow[];
}

export interface PlayerStat {
  playerId: number;
  name: string;
  teamId: number;
  teamName: string;
  games: number;
  wins: number;
  losses: number;
  hits: number;
  cups: number;
  bounce: number;
  bomb: number;
  lastCup: number;
}

export interface TickerItem {
  id: number;
  matchId: number;
  playerId: number;
  playerName: string;
  teamName: string;
  type: ThrowType;
  cups: number;
  /** Becher des gesamten Ereignisses; bei einer Bombe die Summe beider Spieler. */
  total: number;
  lastCup: boolean;
}

export interface State {
  phase: Phase;
  settings: Settings;
  teams: TeamView[];
  matches: MatchView[];
  groups: GroupTable[];
  leaderboard: StandingRow[];
  playerStats: PlayerStat[];
  ticker: TickerItem[];
  koRounds: number;
  champion: number | null;
}
