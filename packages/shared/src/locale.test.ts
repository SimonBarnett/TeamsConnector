import { describe, expect, it } from "vitest";
import { isBcp47 } from "./locale.ts";

describe("isBcp47", () => {
  it("accepts simple and regional tags", () => {
    expect(isBcp47("en")).toBe(true);
    expect(isBcp47("en-GB")).toBe(true);
    expect(isBcp47("zh-Hant")).toBe(true);
  });

  it("rejects empty and malformed tags", () => {
    expect(isBcp47("")).toBe(false);
    expect(isBcp47("english")).toBe(false);
    expect(isBcp47("en_GB")).toBe(false);
  });
});
