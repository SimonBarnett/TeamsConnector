import type {
  Artifact,
  CallMeta,
  SessionRecord,
  StandingRoutine,
  TranscriptSegment,
} from "@teams-audio-join/shared";

export interface ConnectionRecord {
  tenantId: string;
  userId: string;
  workAccountUpn: string;
  connectedAt: string;
  graphUserId?: string;
}

export interface TenantInstall {
  tenantId: string;
  installedAt: string;
  trackAConsented: boolean;
  trackBConsented: boolean;
}

export interface ConsentAck {
  tenantId: string;
  userId: string;
  acknowledgedAt: string;
}

export type { StandingRoutine };

export interface AuditEvent {
  ts: string;
  tenantId: string;
  userId: string;
  agentId: string;
  meetingId?: string;
  sessionId?: string;
  action: string;
  plane?: string;
  result: string;
  detail?: string;
}

export interface IdempotencyRecord {
  key: string;
  tool: string;
  principal: string;
  createdAt: string;
  expiresAt: number;
  resultJson: string;
}

export interface ConnectorStore {
  getTenant(tenantId: string): Promise<TenantInstall | undefined>;
  putTenant(row: TenantInstall): Promise<void>;

  getConnection(tenantId: string, userId: string): Promise<ConnectionRecord | undefined>;
  putConnection(row: ConnectionRecord): Promise<void>;

  getAck(tenantId: string, userId: string): Promise<ConsentAck | undefined>;
  putAck(row: ConsentAck): Promise<void>;

  listRoutines(tenantId: string, userId: string): Promise<StandingRoutine[]>;
  putRoutine(row: StandingRoutine): Promise<void>;
  getRoutine(routineId: string): Promise<StandingRoutine | undefined>;
  deleteRoutine(tenantId: string, userId: string, routineId: string): Promise<boolean>;

  getSession(sessionId: string): Promise<SessionRecord | undefined>;
  putSession(row: SessionRecord): Promise<void>;
  listLiveByUser(tenantId: string, userId: string): Promise<SessionRecord[]>;
  findLiveByMeeting(tenantId: string, userId: string, meetingKey: string): Promise<SessionRecord | undefined>;
  countJoinsSince(tenantId: string, userId: string, sinceMs: number): Promise<number>;

  appendSegments(sessionId: string, segments: TranscriptSegment[]): Promise<void>;
  listSegments(sessionId: string, sinceSeq: number, includePartials: boolean, limit: number): Promise<TranscriptSegment[]>;
  maxSeq(sessionId: string): Promise<number>;
  storedObjectNames(sessionId: string): Promise<string[]>;

  putArtifact(artifact: Artifact): Promise<void>;
  getArtifact(artifactId: string): Promise<Artifact | undefined>;
  latestArtifact(sessionId: string, style: string): Promise<Artifact | undefined>;

  putIdempotency(row: IdempotencyRecord): Promise<void>;
  getIdempotency(key: string, tool: string, principal: string): Promise<IdempotencyRecord | undefined>;

  appendAudit(event: AuditEvent): Promise<void>;
  listAudit(sessionId: string): Promise<AuditEvent[]>;
}

export type { CallMeta };
