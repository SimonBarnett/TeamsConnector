import { describe, expect, it } from "vitest";
import { parseHostConfig } from "./env.ts";
import { formatDoctor, runDoctor } from "./doctor.ts";

describe("runDoctor", () => {
  it("passes fixture-loopback with an honest media note", async () => {
    const report = await runDoctor(parseHostConfig({ NODE_ENV: "test" }));
    expect(report.mode).toBe("fixture-loopback");
    expect(report.checks.find((c) => c.name === "media")?.detail).toMatch(/loopback/);
    expect(formatDoctor(report)).toContain("mode=fixture-loopback");
  });

  it("fails ready when DATABASE_URL is set but Postgres is unreachable", async () => {
    const report = await runDoctor(parseHostConfig({ NODE_ENV: "test", DATABASE_URL: "postgres://x" }));
    expect(report.ok).toBe(false);
    expect(report.checks.find((c) => c.name === "postgres")?.ok).toBe(false);
  });

  it("fails media when Graph is configured without a worker URL", async () => {
    const report = await runDoctor(
      parseHostConfig({
        NODE_ENV: "production",
        AZURE_TENANT_ID: "t",
        AZURE_CLIENT_ID: "c",
        AZURE_CLIENT_SECRET: "s",
        GRAPH_USER_ID: "u",
        ARTIFACT_ENCRYPTION_KEY: "k",
      }),
    );
    expect(report.checks.find((c) => c.name === "media")?.ok).toBe(false);
  });
});
