import type { ConnectorError, ConnectorErrorBody } from "./errors.ts";

export interface SuccessEnvelope<T> {
  ok: true;
  data: T;
  requestId?: string;
}

export interface FailureEnvelope {
  ok: false;
  error: ConnectorErrorBody;
  requestId?: string;
}

export type Envelope<T> = SuccessEnvelope<T> | FailureEnvelope;

export function ok<T>(data: T, requestId?: string): SuccessEnvelope<T> {
  const env: SuccessEnvelope<T> = { ok: true, data };
  if (requestId) env.requestId = requestId;
  return env;
}

export function fail(error: ConnectorError, requestId?: string): FailureEnvelope {
  const env: FailureEnvelope = { ok: false, error: error.toBody() };
  if (requestId) env.requestId = requestId;
  return env;
}
