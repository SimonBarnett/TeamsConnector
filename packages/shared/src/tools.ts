export const MCP_TOOLS = [
  {
    name: "join_meeting",
    description:
      "Join or attach to a Microsoft Teams meeting to take notes. Does not speak unless mode=listen_speak.",
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
    description: "Queue a short utterance into the meeting. Rejected when mode is listen or plane is transcript.",
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
] as const;

export type ToolName = (typeof MCP_TOOLS)[number]["name"];
