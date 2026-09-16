import { describe, expect, it } from "vitest";
import { ERROR_CODES } from "./enums.ts";
import { isRetryable } from "./errors.ts";

describe("error codes", () => {
  it("covers the OpenAPI ErrorCode enum", () => {
    expect(ERROR_CODES).toContain("unauthenticated");
    expect(ERROR_CODES).toContain("rate_limited");
    expect(ERROR_CODES).toContain("policy_missing");
    expect(ERROR_CODES).toHaveLength(18);
  });

  it("marks only the spec-retryable codes as retryable", () => {
    expect(isRetryable("lobby_timeout")).toBe(true);
    expect(isRetryable("plane_unavailable")).toBe(true);
    expect(isRetryable("speak_capped")).toBe(true);
    expect(isRetryable("stt_degraded")).toBe(true);
    expect(isRetryable("dependency_unavailable")).toBe(true);
    expect(isRetryable("rate_limited")).toBe(true);
    expect(isRetryable("mode_unsupported")).toBe(false);
    expect(isRetryable("content_filtered")).toBe(false);
    expect(isRetryable("consent_required")).toBe(false);
  });
});
