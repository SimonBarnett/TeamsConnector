/**
 * MRB FAIL #2 item 4: plane=auto must not select media because a worker
 * reports healthy/mediaReady alone.
 */
import { describe, expect, it } from "vitest";
import { selectPlane } from "./plane.ts";

describe("MRB2 plane=auto freeze vs mediaReady/healthy", () => {
  it("auto+listen stays transcript when media worker is healthy (mediaReady-equivalent)", () => {
    expect(
      selectPlane(
        { mode: "listen", plane: "auto" },
        { mediaWorkerHealthy: true, trackBConsented: true },
      ),
    ).toBe("transcript");
  });

  it("auto+listen stays transcript when worker unhealthy", () => {
    expect(
      selectPlane(
        { mode: "listen", plane: "auto" },
        { mediaWorkerHealthy: false, trackBConsented: true },
      ),
    ).toBe("transcript");
  });

  it("explicit plane=media still requires consent+healthy (no silent auto path)", () => {
    expect(() =>
      selectPlane(
        { mode: "listen", plane: "media" },
        { mediaWorkerHealthy: true, trackBConsented: false },
      ),
    ).toThrow(/media_permission_denied|listen_speak/);
  });
});
