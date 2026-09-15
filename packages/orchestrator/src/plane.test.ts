import { describe, expect, it } from "vitest";
import { ConnectorError } from "@teams-audio-join/shared";
import { selectPlane } from "./plane.ts";

describe("plane selection", () => {
  it("defaults auto+listen to transcript in Phase 1", () => {
    expect(
      selectPlane(
        { mode: "listen", plane: "auto" },
        { mediaWorkerHealthy: false, trackBConsented: false },
      ),
    ).toBe("transcript");
  });

  it("rejects listen_speak when Track B is unavailable", () => {
    expect(() =>
      selectPlane(
        { mode: "listen_speak", plane: "auto" },
        { mediaWorkerHealthy: false, trackBConsented: false },
      ),
    ).toThrow(ConnectorError);
  });

  it("upgrades listen_speak+transcript when media is healthy and consented", () => {
    expect(
      selectPlane(
        { mode: "listen_speak", plane: "transcript" },
        { mediaWorkerHealthy: true, trackBConsented: true },
      ),
    ).toBe("media");
  });

  it("requires media for avatar=true and does not join transcript silently", () => {
    expect(
      selectPlane(
        { mode: "listen", plane: "auto", avatar: true },
        { mediaWorkerHealthy: true, trackBConsented: true },
      ),
    ).toBe("media");
    expect(() =>
      selectPlane(
        { mode: "listen", plane: "transcript", avatar: true },
        { mediaWorkerHealthy: false, trackBConsented: false },
      ),
    ).toThrow(ConnectorError);
  });
});
