import type { ErrorCode } from "./enums.ts";

export const RETRYABLE_CODES: ReadonlySet<ErrorCode> = new Set([
  "lobby_timeout",
  "plane_unavailable",
  "speak_capped",
  "stt_degraded",
  "dependency_unavailable",
  "rate_limited",
]);

export interface ConnectorErrorBody {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export class ConnectorError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ConnectorError";
    this.code = code;
    this.retryable = RETRYABLE_CODES.has(code);
    this.details = details;
  }

  toBody(): ConnectorErrorBody {
    const body: ConnectorErrorBody = {
      code: this.code,
      message: this.message.slice(0, 500),
      retryable: this.retryable,
    };
    if (this.details) body.details = this.details;
    return body;
  }
}

export function isRetryable(code: ErrorCode): boolean {
  return RETRYABLE_CODES.has(code);
}
