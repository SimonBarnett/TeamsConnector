import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ERROR_CODES, EVENT_TYPES, MCP_TOOLS, SESSION_STATES } from "./index.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("OpenAPI contract", () => {
  const spec = JSON.parse(readFileSync(resolve(root, "contracts/teams_audio_join.openapi.json"), "utf8")) as {
    paths: Record<string, unknown>;
    components: {
      schemas: {
        ErrorCode: { enum: string[] };
        SessionState: { enum: string[] };
        EventType: { enum: string[] };
      };
    };
  };

  it("registers the seven MCP tools as paths", () => {
    for (const tool of MCP_TOOLS) {
      expect(spec.paths[`/tools/${tool.name}`]).toBeDefined();
    }
  });

  it("matches ErrorCode, SessionState, and EventType enums", () => {
    expect(spec.components.schemas.ErrorCode.enum).toEqual([...ERROR_CODES]);
    expect(spec.components.schemas.SessionState.enum).toEqual([...SESSION_STATES]);
    expect(spec.components.schemas.EventType.enum).toEqual([...EVENT_TYPES]);
  });

  it("declares avatar join flag, canShowVideo, and still_avatar video status", () => {
    const raw = JSON.parse(readFileSync(resolve(root, "contracts/teams_audio_join.openapi.json"), "utf8")) as {
      info: { version: string };
      components: {
        schemas: {
          Capabilities: { required: string[] };
          JoinMeetingRequest: { properties: { avatar?: { default?: boolean } } };
          VideoStatus: { properties: { source: { enum: string[] } } };
        };
      };
    };
    expect(raw.info.version).toBe("1.3.0");
    expect(raw.components.schemas.Capabilities.required).toContain("canShowVideo");
    expect(raw.components.schemas.JoinMeetingRequest.properties.avatar?.default).toBe(false);
    expect(raw.components.schemas.VideoStatus.properties.source.enum).toEqual(["still_avatar", "none"]);
  });
});
