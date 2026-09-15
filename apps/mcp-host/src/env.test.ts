import { describe, expect, it } from "vitest";
import { assertHostConfig, parseHostConfig } from "./env.ts";

describe("parseHostConfig", () => {
  it("is fixture-loopback without Azure", () => {
    const cfg = parseHostConfig({ NODE_ENV: "test" });
    expect(cfg.mode).toBe("fixture-loopback");
    expect(cfg.demo).toBe(true);
    expect(cfg.mediaEnabled).toBe(true);
  });

  it("is graph-notes-only when Azure is set without a worker URL", () => {
    const cfg = parseHostConfig({
      NODE_ENV: "production",
      AZURE_TENANT_ID: "t",
      AZURE_CLIENT_ID: "c",
      AZURE_CLIENT_SECRET: "s",
      GRAPH_USER_ID: "u",
      ARTIFACT_ENCRYPTION_KEY: "k",
    });
    expect(cfg.mode).toBe("graph-notes-only");
    expect(cfg.azure?.clientId).toBe("c");
  });

  it("flags unknown keys and refuses production fixture mode", () => {
    const cfg = parseHostConfig({ TEAMS_TYPO: "1", NODE_ENV: "test" });
    expect(cfg.unknownKeys).toContain("TEAMS_TYPO");
    expect(() =>
      assertHostConfig({
        ...parseHostConfig({ NODE_ENV: "production" }),
        nodeEnv: "production",
        encryptionKey: "k",
        mode: "fixture-loopback",
      }),
    ).toThrow(/fixture-loopback/);
  });
});
