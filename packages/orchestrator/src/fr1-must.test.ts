/**
 * FR #1 / issue #1 — MUST acceptance for Teams Audio Join v1.
 */
import { describe, expect, it } from "vitest";
import { ConnectorError, listedMcpTools, validateJoinMeeting } from "@teams-audio-join/shared";
import { selectPlane } from "./plane.ts";
import { LoopbackMediaWorker } from "./media-loopback.ts";

describe("FR1 MUST — listen default + plane=auto freeze", () => {
  it("M1: join_meeting defaults mode=listen and plane=auto", () => {
    const req = validateJoinMeeting({ onlineMeetingId: "MSo1" });
    expect(req.mode).toBe("listen");
    expect(req.plane).toBe("auto");
  });

  it("M1/M8: plane=auto + listen stays transcript even if worker healthy", () => {
    expect(
      selectPlane(
        { mode: "listen", plane: "auto" },
        { mediaWorkerHealthy: true, trackBConsented: true },
      ),
    ).toBe("transcript");
  });

  it("M2: listen_speak requires healthy consented worker", () => {
    expect(() =>
      selectPlane(
        { mode: "listen_speak", plane: "auto" },
        { mediaWorkerHealthy: false, trackBConsented: false },
      ),
    ).toThrow(ConnectorError);
    expect(
      selectPlane(
        { mode: "listen_speak", plane: "auto" },
        { mediaWorkerHealthy: true, trackBConsented: true },
      ),
    ).toBe("media");
  });

  it("M2: avatar=true requires media worker", () => {
    expect(() =>
      selectPlane(
        { mode: "listen", plane: "auto", avatar: true },
        { mediaWorkerHealthy: false, trackBConsented: false },
      ),
    ).toThrow(ConnectorError);
  });
});

describe("FR1 MUST — honest deaf + fixture speak", () => {
  it("M3: loopback admit is deaf (canHear=false)", async () => {
    const w = new LoopbackMediaWorker();
    const admitted = await w.admit("ses_fr1", { avatar: false, speak: true });
    expect(admitted.canHear).toBe(false);
  });
});

describe("FR1 MUST — workflow tools gated", () => {
  it("M7: workflow MCP tools hidden by default", () => {
    const names = listedMcpTools().map((t) => t.name);
    expect(names).not.toContain("prepare_hours_draft");
    expect(names).not.toContain("upsert_standing_routine");
    expect(names).toContain("join_meeting");
  });

  it("M7: workflow tools appear when includeWorkflows=true", () => {
    const names = listedMcpTools({ includeWorkflows: true }).map((t) => t.name);
    expect(names).toContain("prepare_hours_draft");
  });
});

describe("FR1 MUST — no day-one AccessMedia claim", () => {
  it("M5: listen_speak without Path A consent is media_permission_denied", () => {
    try {
      selectPlane(
        { mode: "listen_speak", plane: "auto" },
        { mediaWorkerHealthy: true, trackBConsented: false },
      );
      expect.unreachable("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ConnectorError);
      expect((e as ConnectorError).code).toBe("media_permission_denied");
    }
  });
});
