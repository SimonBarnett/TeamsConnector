import { describe, expect, it } from "vitest";
import { assertHostConfig, parseHostConfig } from "./env.ts";

const KEY32 = Buffer.alloc(32, 9).toString("base64");

describe("parseHostConfig", () => {
  it("is fixture-loopback without Azure", () => {
    const cfg = parseHostConfig({ NODE_ENV: "test" });
    expect(cfg.mode).toBe("fixture-loopback");
    expect(cfg.demo).toBe(true);
    expect(cfg.mediaEnabled).toBe(true);
    expect(cfg.pollMs).toBe(0);
  });

  it("is graph-notes-only when Azure is set without a worker URL", () => {
    const cfg = parseHostConfig({
      NODE_ENV: "production",
      AZURE_TENANT_ID: "t",
      AZURE_CLIENT_ID: "c",
      AZURE_CLIENT_SECRET: "s",
      GRAPH_USER_ID: "u",
      ARTIFACT_ENCRYPTION_KEY: KEY32,
    });
    expect(cfg.mode).toBe("graph-notes-only");
    expect(cfg.azure?.clientId).toBe("c");
    expect(cfg.pollMs).toBe(15000);
  });

  it("treats AZURE_CLIENT_CERTIFICATE as Graph credentials", () => {
    const cfg = parseHostConfig({
      AZURE_TENANT_ID: "t",
      AZURE_CLIENT_ID: "c",
      AZURE_CLIENT_CERTIFICATE: "-----BEGIN CERTIFICATE-----",
      GRAPH_USER_ID: "u",
    });
    expect(cfg.azure?.clientCertificate).toBeDefined();
    expect(cfg.azure?.clientSecret).toBeUndefined();
    expect(cfg.pollMs).toBe(15000);
  });

  it("flags unknown keys and refuses production fixture mode", () => {
    const cfg = parseHostConfig({ TEAMS_TYPO: "1", NODE_ENV: "test" });
    expect(cfg.unknownKeys).toContain("TEAMS_TYPO");
    expect(() =>
      assertHostConfig({
        ...parseHostConfig({ NODE_ENV: "production" }),
        nodeEnv: "production",
        encryptionKey: KEY32,
        mode: "fixture-loopback",
      }),
    ).toThrow(/fixture-loopback/);
    expect(() =>
      assertHostConfig({
        ...parseHostConfig({ NODE_ENV: "production" }),
        nodeEnv: "production",
        encryptionKey: "short",
        mode: "graph-notes-only",
      }),
    ).toThrow(/32 bytes/);
    expect(() =>
      assertHostConfig({
        ...parseHostConfig({ NODE_ENV: "production" }),
        nodeEnv: "production",
        encryptionKey: KEY32,
        mode: "graph-notes-only",
      }),
    ).toThrow(/MCP_HTTP_SECRET/);
  });
});
