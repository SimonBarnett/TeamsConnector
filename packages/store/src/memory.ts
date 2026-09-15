import { LIVE_STATES, type Artifact, type SessionRecord, type StandingRoutine, type TranscriptSegment } from "@teams-audio-join/shared";
import { EnvelopeCipher } from "./crypto.ts";
import type {
  AuditEvent,
  ConnectionRecord,
  ConnectorStore,
  ConsentAck,
  IdempotencyRecord,
  TenantInstall,
} from "./types.ts";

interface EncryptedSegment {
  sessionId: string;
  seq: number;
  isPartial: boolean;
  ciphertext: string;
}

export class InMemoryStore implements ConnectorStore {
  private tenants = new Map<string, TenantInstall>();
  private connections = new Map<string, ConnectionRecord>();
  private acks = new Map<string, ConsentAck>();
  private routines = new Map<string, StandingRoutine>();
  private sessions = new Map<string, SessionRecord>();
  private segments: EncryptedSegment[] = [];
  private artifacts = new Map<string, string>();
  private idem = new Map<string, IdempotencyRecord>();
  private audit: AuditEvent[] = [];
  readonly objectNames = new Map<string, string[]>();

  constructor(private readonly cipher: EnvelopeCipher = EnvelopeCipher.fromEnv(undefined)) {}

  async getTenant(tenantId: string) {
    return this.tenants.get(tenantId);
  }
  async putTenant(row: TenantInstall) {
    this.tenants.set(row.tenantId, row);
  }

  async getConnection(tenantId: string, userId: string) {
    return this.connections.get(`${tenantId}:${userId}`);
  }
  async putConnection(row: ConnectionRecord) {
    this.connections.set(`${row.tenantId}:${row.userId}`, row);
  }

  async getAck(tenantId: string, userId: string) {
    return this.acks.get(`${tenantId}:${userId}`);
  }
  async putAck(row: ConsentAck) {
    this.acks.set(`${row.tenantId}:${row.userId}`, row);
  }

  async listRoutines(tenantId: string, userId: string) {
    return [...this.routines.values()].filter((s) => s.tenantId === tenantId && s.userId === userId);
  }
  async putRoutine(row: StandingRoutine) {
    this.routines.set(row.routineId, structuredClone(row));
  }
  async getRoutine(routineId: string) {
    return this.routines.get(routineId);
  }
  async deleteRoutine(tenantId: string, userId: string, routineId: string) {
    const row = this.routines.get(routineId);
    if (!row || row.tenantId !== tenantId || row.userId !== userId) return false;
    this.routines.delete(routineId);
    return true;
  }

  async getSession(sessionId: string) {
    return this.sessions.get(sessionId);
  }
  async putSession(row: SessionRecord) {
    this.sessions.set(row.sessionId, structuredClone(row));
  }
  async listLiveByUser(tenantId: string, userId: string) {
    return [...this.sessions.values()].filter(
      (s) => s.tenantId === tenantId && s.userId === userId && LIVE_STATES.has(s.state),
    );
  }
  async findLiveByMeeting(tenantId: string, userId: string, meetingKey: string) {
    return [...this.sessions.values()].find(
      (s) =>
        s.tenantId === tenantId &&
        s.userId === userId &&
        s.meetingKey === meetingKey &&
        LIVE_STATES.has(s.state),
    );
  }
  async countJoinsSince(tenantId: string, userId: string, sinceMs: number) {
    return [...this.sessions.values()].filter(
      (s) => s.tenantId === tenantId && s.userId === userId && Date.parse(s.createdAt) >= sinceMs,
    ).length;
  }

  async appendSegments(sessionId: string, segments: TranscriptSegment[]) {
    for (const seg of segments) {
      this.segments = this.segments.filter((s) => !(s.sessionId === sessionId && s.seq === seg.seq));
      this.segments.push({
        sessionId,
        seq: seg.seq,
        isPartial: seg.isPartial,
        ciphertext: this.cipher.encrypt(JSON.stringify(seg)),
      });
    }
  }

  async listSegments(sessionId: string, sinceSeq: number, includePartials: boolean, limit: number) {
    const rows = this.segments
      .filter((s) => s.sessionId === sessionId && s.seq > sinceSeq && (includePartials || !s.isPartial))
      .sort((a, b) => a.seq - b.seq)
      .slice(0, limit);
    return rows.map((r) => JSON.parse(this.cipher.decrypt(r.ciphertext)) as TranscriptSegment);
  }

  async maxSeq(sessionId: string) {
    const seqs = this.segments.filter((s) => s.sessionId === sessionId).map((s) => s.seq);
    return seqs.length ? Math.max(...seqs) : 0;
  }

  async storedObjectNames(sessionId: string) {
    return this.objectNames.get(sessionId) ?? [];
  }

  async putArtifact(artifact: Artifact) {
    this.artifacts.set(artifact.artifactId, this.cipher.encrypt(JSON.stringify(artifact)));
  }
  async getArtifact(artifactId: string) {
    const blob = this.artifacts.get(artifactId);
    return blob ? (JSON.parse(this.cipher.decrypt(blob)) as Artifact) : undefined;
  }
  async latestArtifact(sessionId: string, style: string) {
    const all: Artifact[] = [];
    for (const blob of this.artifacts.values()) {
      const art = JSON.parse(this.cipher.decrypt(blob)) as Artifact;
      if (art.sessionId === sessionId && art.style === style) all.push(art);
    }
    all.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return all[0];
  }

  async putIdempotency(row: IdempotencyRecord) {
    this.idem.set(`${row.principal}:${row.tool}:${row.key}`, row);
  }
  async getIdempotency(key: string, tool: string, principal: string) {
    const row = this.idem.get(`${principal}:${tool}:${key}`);
    if (!row) return undefined;
    if (row.expiresAt < Date.now()) {
      this.idem.delete(`${principal}:${tool}:${key}`);
      return undefined;
    }
    return row;
  }

  async appendAudit(event: AuditEvent) {
    this.audit.push(event);
  }
  async listAudit(sessionId: string) {
    return this.audit.filter((e) => e.sessionId === sessionId);
  }
}
