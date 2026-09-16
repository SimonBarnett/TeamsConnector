import type { ErrorCode } from "@teams-audio-join/shared";

export interface GraphErrorBody {
  code?: string;
  message?: string;
}

export function parseGraphErrorBody(text: string): GraphErrorBody {
  try {
    const json = JSON.parse(text) as { error?: GraphErrorBody };
    if (json.error && typeof json.error === "object") return json.error;
  } catch {
    /* not JSON */
  }
  return { message: text.slice(0, 400) };
}

export function looksLikeMissingAccessPolicy(status: number, body: GraphErrorBody): boolean {
  const blob = `${body.code ?? ""} ${body.message ?? ""}`.toLowerCase();
  if (
    blob.includes("application access policy") ||
    blob.includes("authorization_requestdenied") ||
    blob.includes("erroraccessdenied") ||
    blob.includes("access denied") ||
    body.code === "ErrorAccessDenied" ||
    body.code === "Forbidden"
  ) {
    return true;
  }
  if (status === 403 || status === 401) return true;
  return false;
}

/** Map Graph status+body to a connector ErrorCode. Collection 404 is policy, not a missing meeting. */
export function classifyGraphError(
  status: number,
  body: GraphErrorBody,
  opts?: { collection?: boolean },
): ErrorCode {
  if (opts?.collection && (status === 404 || status === 403 || status === 401)) {
    return "policy_missing";
  }
  if (looksLikeMissingAccessPolicy(status, body) || status === 403) return "policy_missing";
  if (status === 404) return "meeting_not_found";
  return "dependency_unavailable";
}

export class GraphHttpError extends Error {
  readonly status: number;
  readonly graphCode?: string;
  readonly connectorCode: ErrorCode;

  constructor(status: number, bodyText: string, opts?: { collection?: boolean }) {
    const parsed = parseGraphErrorBody(bodyText);
    const connectorCode = classifyGraphError(status, parsed, opts);
    super(parsed.message?.slice(0, 500) || `graph ${status}`);
    this.name = "GraphHttpError";
    this.status = status;
    this.graphCode = parsed.code;
    this.connectorCode = connectorCode;
  }
}
