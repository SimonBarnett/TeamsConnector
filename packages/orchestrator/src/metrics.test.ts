import { describe, expect, it } from "vitest";
import { Metrics } from "./metrics.ts";

describe("Metrics", () => {
  it("increments join_success and renders prometheus text", () => {
    const m = new Metrics();
    m.inc("join_success");
    m.observe("leave_latency", 12);
    expect(m.get("join_success")).toBe(1);
    const text = m.renderPrometheus();
    expect(text).toContain("join_success 1");
    expect(text).toContain("leave_latency_ms_sum 12");
  });
});
