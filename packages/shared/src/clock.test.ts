import { describe, expect, it } from "vitest";
import { nowIso } from "./clock.ts";

describe("nowIso", () => {
  it("emits RFC3339 UTC", () => {
    expect(nowIso(new Date("2026-09-15T12:00:00.000Z"))).toBe("2026-09-15T12:00:00.000Z");
  });
});
