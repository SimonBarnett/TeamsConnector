import { LIVE_STATES, type Artifact, type SessionRecord, type StandingRoutine, type TranscriptSegment } from "@teams-audio-join/shared";
import type { EnvelopeCipher } from "./crypto.ts";
import { SCHEMA_SQL } from "./schema.ts";
import type {
  AuditEvent,
  ConnectionRecord,
  ConnectorStore,
  ConsentAck,
  IdempotencyRecord,
  TenantInstall,
} from "./types.ts";

type PgPool = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  end: () => Promise<void>;
};

export class PgStore implements ConnectorStore {
  constructor(
    private readonly pool: PgPool,
    private readonly cipher: EnvelopeCipher,
  ) {}

  static async connect(databaseUrl: string, cipher: EnvelopeCipher): Promise<PgStore> {
    const pg = await import("pg");
    const pool = new pg.default.Pool({
      connectionString: databaseUrl,
      ssl: /amazonaws\.com/i.test(databaseUrl) ? { rejectUnauthorized: false } : undefined,
    }) as unknown as PgPool;
    const store = new PgStore(pool, cipher);
    await store.migrate();
    await pool.query("SELECT 1");
    return store;
  }

  static async ping(databaseUrl: string): Promise<boolean> {
    try {
      const pg = await import("pg");
      const pool = new pg.default.Pool({
        connectionString: databaseUrl,
        connectionTimeoutMillis: 3000,
        ssl: /amazonaws\.com/i.test(databaseUrl) ? { rejectUnauthorized: false } : undefined,
      });
      await pool.query("SELECT 1");
      await pool.end();
      return true;
    } catch {
      return false;
    }
  }

  private async migrate(): Promise<void> {
    await this.pool.query(SCHEMA_SQL);
  }

  async getTenant(tenantId: string) {
    const { rows } = await this.pool.query("SELECT * FROM tenant_installs WHERE tenant_id=$1", [tenantId]);
    const r = rows[0];
    if (!r) return undefined;
    return {
      tenantId: String(r.tenant_id),
      installedAt: new Date(String(r.installed_at)).toISOString(),
      trackAConsented: Boolean(r.track_a_consented),
      trackBConsented: Boolean(r.track_b_consented),
    } satisfies TenantInstall;
  }
  async putTenant(row: TenantInstall) {
    await this.pool.query(
      `INSERT INTO tenant_installs(tenant_id, installed_at, track_a_consented, track_b_consented)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (tenant_id) DO UPDATE SET track_a_consented=$3, track_b_consented=$4`,
      [row.tenantId, row.installedAt, row.trackAConsented, row.trackBConsented],
    );
  }

  async getConnection(tenantId: string, userId: string) {
    const { rows } = await this.pool.query("SELECT * FROM connections WHERE tenant_id=$1 AND user_id=$2", [tenantId, userId]);
    const r = rows[0];
    if (!r) return undefined;
    return {
      tenantId: String(r.tenant_id),
      userId: String(r.user_id),
      workAccountUpn: String(r.work_account_upn),
      connectedAt: new Date(String(r.connected_at)).toISOString(),
      graphUserId: r.graph_user_id ? String(r.graph_user_id) : undefined,
    } satisfies ConnectionRecord;
  }
  async putConnection(row: ConnectionRecord) {
    await this.pool.query(
      `INSERT INTO connections(tenant_id, user_id, work_account_upn, connected_at, graph_user_id)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (tenant_id, user_id) DO UPDATE SET work_account_upn=$3, graph_user_id=$5`,
      [row.tenantId, row.userId, row.workAccountUpn, row.connectedAt, row.graphUserId ?? null],
    );
  }

  async getAck(tenantId: string, userId: string) {
    const { rows } = await this.pool.query("SELECT * FROM consent_acks WHERE tenant_id=$1 AND user_id=$2", [tenantId, userId]);
    const r = rows[0];
    if (!r) return undefined;
    return { tenantId: String(r.tenant_id), userId: String(r.user_id), acknowledgedAt: new Date(String(r.acknowledged_at)).toISOString() } satisfies ConsentAck;
  }
  async putAck(row: ConsentAck) {
    await this.pool.query(
      `INSERT INTO consent_acks(tenant_id, user_id, acknowledged_at) VALUES ($1,$2,$3)
       ON CONFLICT (tenant_id, user_id) DO UPDATE SET acknowledged_at=$3`,
      [row.tenantId, row.userId, row.acknowledgedAt],
    );
  }

  async listRoutines(tenantId: string, userId: string) {
    const { rows } = await this.pool.query("SELECT * FROM standing_routines WHERE tenant_id=$1 AND user_id=$2", [tenantId, userId]);
    return rows.map((r) => this.rowToRoutine(r));
  }
  async putRoutine(row: StandingRoutine) {
    await this.pool.query(
      `INSERT INTO standing_routines(routine_id, tenant_id, user_id, label, enabled, mode, plane, avatar, match_json, hours_draft, owner_memo, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (routine_id) DO UPDATE SET label=$4, enabled=$5, mode=$6, plane=$7, avatar=$8, match_json=$9, hours_draft=$10, owner_memo=$11`,
      [row.routineId, row.tenantId, row.userId, row.label, row.enabled, row.mode, row.plane, row.avatar, JSON.stringify(row.match), row.hoursDraft, row.ownerMemo, row.createdAt],
    );
  }
  async getRoutine(routineId: string) {
    const { rows } = await this.pool.query("SELECT * FROM standing_routines WHERE routine_id=$1", [routineId]);
    return rows[0] ? this.rowToRoutine(rows[0]) : undefined;
  }
  async deleteRoutine(tenantId: string, userId: string, routineId: string) {
    const { rows } = await this.pool.query(
      "DELETE FROM standing_routines WHERE tenant_id=$1 AND user_id=$2 AND routine_id=$3 RETURNING routine_id",
      [tenantId, userId, routineId],
    );
    return rows.length > 0;
  }

  async getSession(sessionId: string) {
    const { rows } = await this.pool.query("SELECT * FROM sessions WHERE session_id=$1", [sessionId]);
    return rows[0] ? this.rowToSession(rows[0]) : undefined;
  }
  async putSession(row: SessionRecord) {
    await this.pool.query(
      `INSERT INTO sessions(session_id, tenant_id, user_id, agent_id, state, plane, mode, created_at, started_at, admitted_at, ended_at, ended_reason, meeting_json, meeting_key, locale, announce, wait_for_admit_sec, capabilities_json, participants_json, last_error_json, speak_json, last_artifact_id, avatar, video_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
       ON CONFLICT (session_id) DO UPDATE SET state=$5, plane=$6, mode=$7, started_at=$9, admitted_at=$10, ended_at=$11, ended_reason=$12, meeting_json=$13, capabilities_json=$18, participants_json=$19, last_error_json=$20, speak_json=$21, last_artifact_id=$22, avatar=$23, video_json=$24`,
      [
        row.sessionId, row.tenantId, row.userId, row.agentId, row.state, row.plane, row.mode, row.createdAt,
        row.startedAt ?? null, row.admittedAt ?? null, row.endedAt ?? null, row.endedReason ?? null,
        JSON.stringify(row.meeting), row.meetingKey, row.locale ?? null, row.announce, row.waitForAdmitSec,
        JSON.stringify(row.capabilities), JSON.stringify(row.participants), row.lastError ? JSON.stringify(row.lastError) : null,
        JSON.stringify(row.speak), row.lastArtifactId ?? null, row.avatar, row.video ? JSON.stringify(row.video) : null,
      ],
    );
  }
  async listLiveByUser(tenantId: string, userId: string) {
    const all = await this.pool.query("SELECT * FROM sessions WHERE tenant_id=$1 AND user_id=$2", [tenantId, userId]);
    return all.rows.map((r) => this.rowToSession(r)).filter((s) => LIVE_STATES.has(s.state));
  }
  async findLiveByMeeting(tenantId: string, userId: string, meetingKey: string) {
    const live = await this.listLiveByUser(tenantId, userId);
    return live.find((s) => s.meetingKey === meetingKey);
  }
  async countJoinsSince(tenantId: string, userId: string, sinceMs: number) {
    const { rows } = await this.pool.query(
      "SELECT COUNT(*)::int AS n FROM sessions WHERE tenant_id=$1 AND user_id=$2 AND created_at >= to_timestamp($3/1000.0)",
      [tenantId, userId, sinceMs],
    );
    return Number(rows[0]?.n ?? 0);
  }

  async appendSegments(sessionId: string, segments: TranscriptSegment[]) {
    for (const seg of segments) {
      await this.pool.query(
        `INSERT INTO transcript_segments(session_id, seq, is_partial, ciphertext) VALUES ($1,$2,$3,$4)
         ON CONFLICT (session_id, seq) DO UPDATE SET is_partial=$3, ciphertext=$4`,
        [sessionId, seg.seq, seg.isPartial, this.cipher.encrypt(JSON.stringify(seg))],
      );
    }
  }
  async listSegments(sessionId: string, sinceSeq: number, includePartials: boolean, limit: number) {
    const { rows } = await this.pool.query(
      `SELECT ciphertext FROM transcript_segments WHERE session_id=$1 AND seq>$2 AND ($3 OR NOT is_partial) ORDER BY seq ASC LIMIT $4`,
      [sessionId, sinceSeq, includePartials, limit],
    );
    return rows.map((r) => JSON.parse(this.cipher.decrypt(String(r.ciphertext))) as TranscriptSegment);
  }
  async maxSeq(sessionId: string) {
    const { rows } = await this.pool.query("SELECT COALESCE(MAX(seq),0)::int AS n FROM transcript_segments WHERE session_id=$1", [sessionId]);
    return Number(rows[0]?.n ?? 0);
  }
  async storedObjectNames(_sessionId: string) {
    return [];
  }

  async putArtifact(artifact: Artifact) {
    await this.pool.query(
      `INSERT INTO artifacts(artifact_id, session_id, style, created_at, ciphertext) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (artifact_id) DO UPDATE SET ciphertext=$5`,
      [artifact.artifactId, artifact.sessionId, artifact.style, artifact.createdAt, this.cipher.encrypt(JSON.stringify(artifact))],
    );
  }
  async getArtifact(artifactId: string) {
    const { rows } = await this.pool.query("SELECT ciphertext FROM artifacts WHERE artifact_id=$1", [artifactId]);
    const c = rows[0]?.ciphertext;
    return c ? (JSON.parse(this.cipher.decrypt(String(c))) as Artifact) : undefined;
  }
  async latestArtifact(sessionId: string, style: string) {
    const { rows } = await this.pool.query(
      "SELECT ciphertext FROM artifacts WHERE session_id=$1 AND style=$2 ORDER BY created_at DESC LIMIT 1",
      [sessionId, style],
    );
    const c = rows[0]?.ciphertext;
    return c ? (JSON.parse(this.cipher.decrypt(String(c))) as Artifact) : undefined;
  }

  async putIdempotency(row: IdempotencyRecord) {
    await this.pool.query(
      `INSERT INTO idempotency_keys(principal, tool, key, created_at, expires_at, result_json) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (principal, tool, key) DO UPDATE SET result_json=$6, expires_at=$5`,
      [row.principal, row.tool, row.key, row.createdAt, row.expiresAt, row.resultJson],
    );
  }
  async getIdempotency(key: string, tool: string, principal: string) {
    const { rows } = await this.pool.query(
      "SELECT * FROM idempotency_keys WHERE principal=$1 AND tool=$2 AND key=$3",
      [principal, tool, key],
    );
    const r = rows[0];
    if (!r) return undefined;
    if (Number(r.expires_at) < Date.now()) return undefined;
    return {
      key,
      tool,
      principal,
      createdAt: String(r.created_at),
      expiresAt: Number(r.expires_at),
      resultJson: String(r.result_json),
    };
  }

  async appendAudit(event: AuditEvent) {
    await this.pool.query(
      `INSERT INTO audit_events(ts, tenant_id, user_id, agent_id, meeting_id, session_id, action, plane, result, detail)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [event.ts, event.tenantId, event.userId, event.agentId, event.meetingId ?? null, event.sessionId ?? null, event.action, event.plane ?? null, event.result, event.detail ?? null],
    );
  }
  async listAudit(sessionId: string) {
    const { rows } = await this.pool.query("SELECT * FROM audit_events WHERE session_id=$1 ORDER BY id", [sessionId]);
    return rows.map((r) => ({
      ts: new Date(String(r.ts)).toISOString(),
      tenantId: String(r.tenant_id),
      userId: String(r.user_id),
      agentId: String(r.agent_id),
      meetingId: r.meeting_id ? String(r.meeting_id) : undefined,
      sessionId: r.session_id ? String(r.session_id) : undefined,
      action: String(r.action),
      plane: r.plane ? String(r.plane) : undefined,
      result: String(r.result),
      detail: r.detail ? String(r.detail) : undefined,
    })) as AuditEvent[];
  }

  async sweepExpired(nowMs: number, ttlMs: number) {
    const cutoff = new Date(nowMs - ttlMs).toISOString();
    const seg = await this.pool.query("DELETE FROM transcript_segments WHERE created_at < $1", [cutoff]);
    const art = await this.pool.query("DELETE FROM artifacts WHERE created_at < $1", [cutoff]);
    return { segments: Number((seg as { rowCount?: number }).rowCount ?? 0), artifacts: Number((art as { rowCount?: number }).rowCount ?? 0) };
  }

  private rowToRoutine(r: Record<string, unknown>): StandingRoutine {
    return {
      routineId: String(r.routine_id),
      tenantId: String(r.tenant_id),
      userId: String(r.user_id),
      label: String(r.label),
      enabled: Boolean(r.enabled),
      mode: r.mode === "listen_speak" ? "listen_speak" : "listen",
      plane: r.plane === "transcript" ? "transcript" : "auto",
      avatar: Boolean(r.avatar),
      match: JSON.parse(String(r.match_json)),
      hoursDraft: Boolean(r.hours_draft),
      ownerMemo: Boolean(r.owner_memo),
      createdAt: new Date(String(r.created_at)).toISOString(),
    };
  }

  private rowToSession(r: Record<string, unknown>): SessionRecord {
    const session: SessionRecord = {
      sessionId: String(r.session_id),
      tenantId: String(r.tenant_id),
      userId: String(r.user_id),
      agentId: String(r.agent_id),
      state: r.state as SessionRecord["state"],
      plane: r.plane as SessionRecord["plane"],
      mode: r.mode as SessionRecord["mode"],
      createdAt: new Date(String(r.created_at)).toISOString(),
      meeting: JSON.parse(String(r.meeting_json)),
      meetingKey: String(r.meeting_key),
      announce: Boolean(r.announce),
      waitForAdmitSec: Number(r.wait_for_admit_sec),
      avatar: Boolean(r.avatar),
      capabilities: JSON.parse(String(r.capabilities_json)),
      participants: JSON.parse(String(r.participants_json)),
      speak: JSON.parse(String(r.speak_json)),
    };
    if (r.started_at) session.startedAt = new Date(String(r.started_at)).toISOString();
    if (r.admitted_at) session.admittedAt = new Date(String(r.admitted_at)).toISOString();
    if (r.ended_at) session.endedAt = new Date(String(r.ended_at)).toISOString();
    if (r.ended_reason) session.endedReason = r.ended_reason as SessionRecord["endedReason"];
    if (r.locale) session.locale = String(r.locale);
    if (r.last_error_json) session.lastError = JSON.parse(String(r.last_error_json));
    if (r.last_artifact_id) session.lastArtifactId = String(r.last_artifact_id);
    if (r.video_json) session.video = JSON.parse(String(r.video_json));
    return session;
  }
}
