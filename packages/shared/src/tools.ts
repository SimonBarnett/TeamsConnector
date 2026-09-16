export const MCP_TOOLS = [
  {
    name: "join_meeting",
    description:
      "Join a Microsoft Teams meeting. Default mode=listen (Track A notes). Pass mode=listen_speak to talk via Path A playPrompt.",
  },
  {
    name: "get_meeting_status",
    description: "Return session state, roster, and whether the assistant can currently hear or speak.",
  },
  {
    name: "get_transcript",
    description: "Pull transcript segments after sinceSeq. Prefer transcript.delta events; use this to catch up.",
  },
  {
    name: "speak",
    description: "Speak a short utterance into the meeting. Upgrades a listen/transcript session to media listen_speak when the worker is up.",
  },
  {
    name: "cancel_speech",
    description: "Stop the current or queued assistant utterance in the meeting.",
  },
  {
    name: "request_summary",
    description: "Build a grounded summary, decisions, and action items from transcript segments.",
  },
  {
    name: "leave_meeting",
    description: "Leave the meeting immediately, revoke tokens, and finalise the summary artifact.",
  },
  {
    name: "upsert_standing_routine",
    description: "Create or update a standing join routine (defaults to listen_speak so the assistant can talk).",
  },
  {
    name: "list_standing_routines",
    description: "List standing listen-only join routines for the bound user.",
  },
  {
    name: "delete_standing_routine",
    description: "Delete a standing join routine.",
  },
  {
    name: "prepare_hours_draft",
    description: "Return a Hours-agent draft from a session artifact. Never posts time. Always requires human confirm.",
  },
] as const;

export type ToolName = (typeof MCP_TOOLS)[number]["name"];
