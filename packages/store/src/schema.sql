-- Teams Agent Audio Join connector — Phase 1 schema.
-- Transcript and artifact bodies are envelope-encrypted in the application.
-- Never store WAV/PCM/Opus objects in these tables.

CREATE TABLE IF NOT EXISTS tenant_installs (
  tenant_id TEXT PRIMARY KEY,
  installed_at TIMESTAMPTZ NOT NULL,
  track_a_consented BOOLEAN NOT NULL DEFAULT TRUE,
  track_b_consented BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS connections (
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  work_account_upn TEXT NOT NULL,
  connected_at TIMESTAMPTZ NOT NULL,
  graph_user_id TEXT,
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS consent_acks (
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  acknowledged_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS standing_allow (
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  meeting_key TEXT NOT NULL,
  mode TEXT NOT NULL,
  PRIMARY KEY (tenant_id, user_id, meeting_key)
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  state TEXT NOT NULL,
  plane TEXT NOT NULL,
  mode TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ,
  admitted_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  ended_reason TEXT,
  meeting_json TEXT NOT NULL,
  meeting_key TEXT NOT NULL,
  locale TEXT,
  announce BOOLEAN NOT NULL DEFAULT FALSE,
  wait_for_admit_sec INTEGER NOT NULL DEFAULT 60,
  capabilities_json TEXT NOT NULL,
  participants_json TEXT NOT NULL,
  last_error_json TEXT,
  speak_json TEXT NOT NULL,
  last_artifact_id TEXT
);

CREATE INDEX IF NOT EXISTS sessions_user_live ON sessions (tenant_id, user_id, state);
CREATE INDEX IF NOT EXISTS sessions_meeting ON sessions (tenant_id, user_id, meeting_key);

CREATE TABLE IF NOT EXISTS transcript_segments (
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  is_partial BOOLEAN NOT NULL,
  ciphertext TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, seq)
);

CREATE TABLE IF NOT EXISTS artifacts (
  artifact_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  style TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  ciphertext TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS artifacts_session ON artifacts (session_id, style, created_at DESC);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  principal TEXT NOT NULL,
  tool TEXT NOT NULL,
  key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at BIGINT NOT NULL,
  result_json TEXT NOT NULL,
  PRIMARY KEY (principal, tool, key)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  meeting_id TEXT,
  session_id TEXT,
  action TEXT NOT NULL,
  plane TEXT,
  result TEXT NOT NULL,
  detail TEXT
);

CREATE INDEX IF NOT EXISTS audit_session ON audit_events (session_id);

CREATE TABLE IF NOT EXISTS standing_routines (
  routine_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  label TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  mode TEXT NOT NULL DEFAULT 'listen',
  plane TEXT NOT NULL DEFAULT 'auto',
  avatar BOOLEAN NOT NULL DEFAULT FALSE,
  match_json TEXT NOT NULL,
  hours_draft BOOLEAN NOT NULL DEFAULT TRUE,
  owner_memo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS standing_routines_user ON standing_routines (tenant_id, user_id);
