import type { Phase } from './game';

export type PlayerReportType =
  | 'bug'
  | 'multiplayer_connection'
  | 'multiplayer_desync'
  | 'rules_issue'
  | 'deck_import'
  | 'player_behavior'
  | 'cheating'
  | 'feedback'
  | 'other';

export type PlayerReportSeverity = 'low' | 'medium' | 'high' | 'critical';
export type PlayerReportPrivacyMode = 'private' | 'sanitized_public' | 'local_export_only';
export type PlayerReportStatus = 'new' | 'triaged' | 'fixing' | 'fixed' | 'resolved' | 'dismissed' | 'duplicate';
export type PlayerReportRetentionClass = 'short' | 'normal' | 'extended' | 'legal_hold' | 'manual_export_only';

export interface SafeActionLogEntry {
  id: string;
  turn: number;
  phase: Phase;
  actionType: string;
  description: string;
  actorId?: string;
  createdAt?: number;
}

export interface PublicReportPlayerSummary {
  playerId: string;
  seatIndex: number;
  life: number;
  battlefieldCount: number;
  graveyardCount: number;
  exileCount: number;
  handCount: number;
  libraryCount: number;
  commanderCount: number;
  isLocalPlayer: boolean;
}

export interface PublicReportGameSnapshot {
  gameId: string;
  status: string;
  turn: number;
  phase: Phase;
  activePlayerId: string;
  priorityPlayerId: string;
  playerCount: number;
  stackCount: number;
  triggerCount: number;
  players: PublicReportPlayerSummary[];
}

export interface ReportDeckContext {
  activeDeckId?: string;
  activeDeckName?: string;
  cardCount?: number;
  commanderCount?: number;
  status?: string;
  deckHash?: string;
}

export interface ReportSafeContext {
  appVersion: string;
  buildCommit: string;
  rulesetVersion?: string;
  browserInfo?: string;
  gameId: string;
  turn: number;
  phase: Phase;
  reporterPlayerId?: string;
  roomCodeHash?: string;
  multiplayerStatus: string;
  lobbyStatus?: string;
  deckStatus?: ReportDeckContext;
  screen: string;
  component?: string;
  actionType?: string;
  recentConsoleErrors?: string[];
  actionLog?: SafeActionLogEntry[];
  publicSnapshot?: PublicReportGameSnapshot;
}

export interface PlayerReportInput {
  type: PlayerReportType;
  severity?: PlayerReportSeverity;
  title: string;
  description: string;
  contactEmail?: string;
  reportedPlayerId?: string;
  component?: string;
  actionType?: string;
  privacyMode?: PlayerReportPrivacyMode;
  retentionClass?: PlayerReportRetentionClass;
  includeActionLog?: boolean;
  includePublicSnapshot?: boolean;
  includePrivateZones?: boolean;
  status?: PlayerReportStatus;
  now?: number;
}

export interface PlayerReport {
  reportId: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  type: PlayerReportType;
  severity: PlayerReportSeverity;
  title: string;
  description: string;
  contactEmail?: string;
  reporterPlayerId?: string;
  reportedPlayerId?: string;
  gameId: string;
  roomCodeHash?: string;
  turn: number;
  phase: Phase;
  screen: string;
  component?: string;
  actionType?: string;
  buildCommit: string;
  appVersion: string;
  rulesetVersion?: string;
  multiplayerStatus: string;
  lobbyStatus?: string;
  deckStatus?: ReportDeckContext;
  includeActionLog: boolean;
  includePublicSnapshot: boolean;
  includePrivateZones: boolean;
  privacyMode: PlayerReportPrivacyMode;
  status: PlayerReportStatus;
  retentionClass: PlayerReportRetentionClass;
  cleanupEligible: boolean;
  resolvedAt?: number;
  dismissedAt?: number;
  fingerprint: string;
  clusterId: string;
  safeContext: ReportSafeContext;
}

export interface ReportCluster {
  clusterId: string;
  fingerprint: string;
  title: string;
  reportType: PlayerReportType;
  severity: PlayerReportSeverity;
  count: number;
  affectedBuilds: string[];
  firstSeenAt: number;
  lastSeenAt: number;
  expiresAt: number;
  sampleReportIds: string[];
  commonContext: {
    screen?: string;
    component?: string;
    actionType?: string;
    multiplayerStatus?: string;
  };
  suggestedAreas: string[];
  sanitizedSummary: string;
  status: PlayerReportStatus;
  reports?: PlayerReport[];
}

export interface CodexTriageSampleReport {
  reportId: string;
  createdAt: number;
  title: string;
  sanitizedDescription: string;
  reproSteps?: string[];
  safeContext: ReportSafeContext;
}

export interface CodexTriageExportCluster {
  clusterId: string;
  title: string;
  severity: PlayerReportSeverity;
  reportType: PlayerReportType;
  count: number;
  affectedBuilds: string[];
  firstSeenAt: number;
  lastSeenAt: number;
  commonSymptoms: string[];
  reproSteps: string[];
  sanitizedLogs: string[];
  suggestedFiles: string[];
  sampleReports: CodexTriageSampleReport[];
}

export interface CodexTriageExport {
  exportVersion: '1';
  exportedAt: number;
  appBuildRange: string[];
  summary: {
    totalReports: number;
    totalClusters: number;
    highestSeverity: PlayerReportSeverity;
    reportTypes: Record<string, number>;
  };
  clusters: CodexTriageExportCluster[];
  privacy: {
    rawReportsIncluded: false;
    privateZonesIncluded: false;
    firebaseUidsIncluded: false;
    participantTokensIncluded: false;
    rawRoomCodesIncluded: false;
  };
}

export interface ReportCleanupSummary {
  deletedReportCount: number;
  deletedClusterCount: number;
  deletedReportIds: string[];
  deletedClusterIds: string[];
  retainedReportCount?: number;
  retainedClusterCount?: number;
  createdAt: number;
}

export interface ReportSubmitResult {
  ok: boolean;
  report: PlayerReport;
  submittedToFirebase: boolean;
  localExportJson: string;
  error?: string;
}
