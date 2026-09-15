import { describe, expect, it } from "vitest";
import { ConnectorError } from "./errors.ts";
import { fail, ok } from "./envelopes.ts";

describe("envelopes", () => {
  it("ok includes requestId when provided", () => {
    expect(ok({ n: 1 }, "req_1")).toEqual({ ok: true, data: { n: 1 }, requestId: "req_1" });
    expect(ok("x")).toEqual({ ok: true, data: "x" });
  });

  it("fail maps ConnectorError and retryable flag", () => {
    const env = fail(new ConnectorError("rate_limited", "slow down", { retryAfterMs: 10 }), "req_2");
    expect(env.ok).toBe(false);
    expect(env.error.code).toBe("rate_limited");
    expect(env.error.retryable).toBe(true);
    expect(env.requestId).toBe("req_2");
  });
});
