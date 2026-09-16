import { MCP_TOOLS, type ToolName } from "./tools.ts";

const sessionId = { type: "string", pattern: "^ses_[0-9A-HJKMNP-TV-Z]{26}$" } as const;

export const TOOL_INPUT_SCHEMAS: Record<ToolName, Record<string, unknown>> = {
  join_meeting: {
    type: "object",
    additionalProperties: false,
    properties: {
      meetingUrl: { type: "string" },
      eventId: { type: "string" },
      onlineMeetingId: { type: "string" },
      mode: { type: "string", enum: ["listen", "listen_speak"] },
      announce: { type: "boolean" },
      plane: { type: "string", enum: ["auto", "transcript", "media"] },
      locale: { type: "string" },
      waitForAdmitSec: { type: "integer" },
      avatar: { type: "boolean" },
    },
  },
  get_meeting_status: {
    type: "object",
    additionalProperties: false,
    required: ["sessionId"],
    properties: { sessionId },
  },
  get_transcript: {
    type: "object",
    additionalProperties: false,
    required: ["sessionId"],
    properties: {
      sessionId,
      sinceSeq: { type: "integer", minimum: 0 },
      limit: { type: "integer", minimum: 1, maximum: 500 },
      includePartials: { type: "boolean" },
    },
  },
  speak: {
    type: "object",
    additionalProperties: false,
    required: ["sessionId", "text"],
    properties: {
      sessionId,
      text: { type: "string", minLength: 1, maxLength: 280 },
      priority: { type: "string", enum: ["normal", "urgent"] },
      voice: { type: "string" },
      allowBargeIn: { type: "boolean" },
    },
  },
  cancel_speech: {
    type: "object",
    additionalProperties: false,
    required: ["sessionId"],
    properties: { sessionId, utteranceId: { type: "string" } },
  },
  request_summary: {
    type: "object",
    additionalProperties: false,
    required: ["sessionId"],
    properties: {
      sessionId,
      style: { type: "string", enum: ["bullets", "memo", "hours"] },
      refresh: { type: "boolean" },
    },
  },
  leave_meeting: {
    type: "object",
    additionalProperties: false,
    required: ["sessionId"],
    properties: { sessionId, reason: { type: "string", enum: ["user_leave", "error"] } },
  },
  upsert_standing_routine: {
    type: "object",
    additionalProperties: false,
    required: ["label", "match"],
    properties: {
      routineId: { type: "string" },
      label: { type: "string" },
      enabled: { type: "boolean" },
      mode: { type: "string", enum: ["listen", "listen_speak"] },
      plane: { type: "string" },
      avatar: { type: "boolean" },
      match: { type: "object" },
      hoursDraft: { type: "boolean" },
      ownerMemo: { type: "boolean" },
    },
  },
  list_standing_routines: { type: "object", additionalProperties: false, properties: {} },
  delete_standing_routine: {
    type: "object",
    additionalProperties: false,
    required: ["routineId"],
    properties: { routineId: { type: "string" } },
  },
  prepare_hours_draft: {
    type: "object",
    additionalProperties: false,
    required: ["sessionId"],
    properties: { sessionId },
  },
};

const WORKFLOW_TOOL_NAMES = new Set<ToolName>([
  "upsert_standing_routine",
  "list_standing_routines",
  "delete_standing_routine",
  "prepare_hours_draft",
]);

/** Spec audio tools (7). Hours/calendar extras stay hidden unless WORKFLOW_TRIGGER=1. */
export function listedMcpTools(opts?: { includeWorkflows?: boolean }) {
  return MCP_TOOLS.filter((t) => opts?.includeWorkflows || !WORKFLOW_TOOL_NAMES.has(t.name)).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: TOOL_INPUT_SCHEMAS[t.name],
  }));
}
