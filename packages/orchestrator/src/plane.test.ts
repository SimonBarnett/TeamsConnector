import { describe, expect, it } from "vitest";
import { ConnectorError } from "@teams-audio-join/shared";
import { selectPlane } from "./plane.ts";

describe("plane selection", () => {
  it("keeps auto+listen on transcript only when the media worker is down", () => {
    expect(
      selectPlane(
        { mode: "listen", plane: "auto" },
        { mediaWorkerHealthy: false, trackBConsented: false },
      ),
    ).toBe("transcript");
  });

  it("keeps auto+listen on transcript even if a worker is healthy (Path A freeze)", () => {
    expect(
      selectPlane(
        { mode: "listen", plane: "auto" },
        { mediaWorkerHealthy: true, trackBConsented: true },
      ),
    ).toBe("transcript");
  });

  it("rejects listen_speak when the media worker is down", () => {
    expect(() =>
      selectPlane(
        { mode: "listen_speak", plane: "auto" },
        { mediaWorkerHealthy: false, trackBConsented: false },
      ),
    ).toThrow(ConnectorError);
  });

  it("upgrades listen_speak+transcript when the media worker is healthy", () => {
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
