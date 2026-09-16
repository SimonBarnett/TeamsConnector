import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ClientCertificateTokenProvider, ClientCredentialsTokenProvider, GraphRestClient, clientAssertionJwt } from "./rest.ts";
import { GraphHttpError, classifyGraphError } from "./http-error.ts";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("ClientCredentialsTokenProvider", () => {
  it("posts client credentials and returns the access token", async () => {
    const p = new ClientCredentialsTokenProvider({
      tenantId: "t",
      clientId: "id",
      clientSecret: "sec",
      fetchImpl: async (url, init) => {
        expect(String(url)).toContain("/t/oauth2/v2.0/token");
        expect(String(init?.body)).toContain("client_credentials");
        return json(200, { access_token: "tok" });
      },
    });
    expect(await p.getToken()).toBe("tok");
  });
});

describe("classifyGraphError", () => {
  it("maps missing application access policy away from meeting_not_found", () => {
    expect(
      classifyGraphError(404, {
        code: "UnknownError",
        message: "No application access policy found for this app.",
      }),
    ).toBe("policy_missing");
    expect(classifyGraphError(403, { code: "ErrorAccessDenied", message: "Forbidden" })).toBe("policy_missing");
    expect(classifyGraphError(404, { message: "The specified online meeting cannot be found" })).toBe(
      "meeting_not_found",
    );
    expect(classifyGraphError(404, { message: "not found" }, { collection: true })).toBe("policy_missing");
    const err = new GraphHttpError(403, JSON.stringify({ error: { code: "Forbidden", message: "nope" } }));
    expect(err.connectorCode).toBe("policy_missing");
  });
});

describe("GraphRestClient", () => {
  const tokens = { async getToken() { return "tok"; } };

  it("resolves by onlineMeetingId and redacts join URLs", async () => {
    const g = new GraphRestClient(tokens, "user-1", async (url) => {
      expect(String(url)).toContain("/onlineMeetings/om-1");
      return json(200, {
        id: "om-1",
        subject: "Catchup",
        joinWebUrl: "https://teams.microsoft.com/l/meetup-join/19%3ax/0?pwd=SECRET",
      });
    });
    const ref = await g.resolveMeeting({ onlineMeetingId: "om-1" });
    expect(ref?.onlineMeetingId).toBe("om-1");
    expect(ref?.joinUrlRedacted ?? "").not.toContain("pwd=");
  });

  it("returns null on 404 and for events without an online meeting", async () => {
    const g404 = new GraphRestClient(tokens, "user-1", async () => json(404, {}));
    expect(await g404.resolveMeeting({ onlineMeetingId: "missing" })).toBeNull();

    const gEv = new GraphRestClient(tokens, "user-1", async (url) => {
      if (String(url).includes("/events/")) return json(200, { subject: "Lunch" });
      return json(404, {});
    });
    expect(await gEv.resolveMeeting({ eventId: "evt-offline" })).toBeNull();
  });

  it("missingAccessPolicyIsNotMeetingNotFound", async () => {
    const g = new GraphRestClient(tokens, "user-1", async () =>
      json(404, { error: { message: "No application access policy found for this app." } }),
    );
    try {
      await g.resolveMeeting({ onlineMeetingId: "om-x" });
      expect.fail("expected GraphHttpError");
    } catch (err) {
      expect(err).toBeInstanceOf(GraphHttpError);
      expect((err as GraphHttpError).connectorCode).toBe("policy_missing");
      expect((err as GraphHttpError).connectorCode).not.toBe("meeting_not_found");
    }
  });

  it("resolves a join URL with extra query via thread id when JoinWebUrl filter misses", async () => {
    const seen: string[] = [];
    const g = new GraphRestClient(tokens, "user-1", async (url) => {
      seen.push(String(url));
      const u = String(url);
      if (u.includes("$filter=")) return json(200, { value: [] });
      if (u.includes("$top=50")) {
        return json(200, {
          value: [
            {
              id: "om-thread",
              joinWebUrl: "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0",
            },
          ],
        });
      }
      return json(500, {});
    });
    const ref = await g.resolveMeeting({
      meetingUrl: "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc/0?pwd=EXTRA&foo=1",
    });
    expect(ref?.onlineMeetingId).toBe("om-thread");
    expect(seen.some((u) => u.includes("$filter=") && u.includes("JoinWebUrl"))).toBe(true);
  });

  it("listTranscripts 404 without policy language is an empty list", async () => {
    const g = new GraphRestClient(tokens, "user-1", async () => json(404, { error: { message: "item not found" } }));
    expect(await g.listTranscripts("om-1")).toEqual([]);
  });

  it("throws policy_missing on transcripts 403 instead of an empty list", async () => {
    const g = new GraphRestClient(tokens, "user-1", async () => json(403, { error: { code: "Forbidden" } }));
    await expect(g.listTranscripts("om-1")).rejects.toMatchObject({ connectorCode: "policy_missing" });
  });

  it("lists transcripts and fetches content", async () => {
    const g = new GraphRestClient(tokens, "user-1", async (url) => {
      if (String(url).includes("/transcripts") && !String(url).includes("/content")) {
        return json(200, { value: [{ id: "tr-1" }] });
      }
      return new Response("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\n", { status: 200 });
    });
    const list = await g.listTranscripts("om-1");
    expect(list[0]?.id).toBe("tr-1");
    expect(list[0]?.onlineMeetingId).toBe("om-1");
    const content = await g.getTranscriptContent({ id: "tr-1", onlineMeetingId: "om-1" });
    expect(content).toContain("WEBVTT");
  });

  it("transcript content URL includes the meeting id", async () => {
    const seen: string[] = [];
    const g = new GraphRestClient(tokens, "user-1", async (url) => {
      seen.push(String(url));
      return new Response("WEBVTT", { status: 200 });
    });
    await g.getTranscriptContent({ id: "tr-9", onlineMeetingId: "om-42" });
    expect(seen[0]).toContain("/onlineMeetings/om-42/transcripts/tr-9/content");
    expect(seen[0]).not.toMatch(/onlineMeetings\/transcripts\//);
  });

  it("reads roster from attendanceReports and does not swallow Graph errors as []", async () => {
    const g = new GraphRestClient(tokens, "user-1", async (url) => {
      const u = String(url);
      expect(u).not.toContain("$expand=participants");
      if (u.endsWith("/attendanceReports")) {
        return json(200, { value: [{ id: "rep-1", meetingEndDateTime: "2026-09-15T13:00:00Z" }] });
      }
      if (u.includes("/attendanceRecords")) {
        return json(200, {
          value: [
            { identity: { id: "u1", displayName: "Ada" }, role: "Organizer" },
            { identity: { user: { id: "u2", displayName: "Bob" } }, role: "Attendee" },
          ],
        });
      }
      return json(500, {});
    });
    const roster = await g.getParticipants("om-1");
    expect(roster.map((p) => p.displayName).sort()).toEqual(["Ada", "Bob"]);

    const boom = new GraphRestClient(tokens, "user-1", async () => json(403, { error: { code: "Forbidden" } }));
    await expect(boom.getParticipants("om-1")).rejects.toMatchObject({ connectorCode: "policy_missing" });
  });

  it("probeAccessPolicy treats collection 404 as policy_missing", async () => {
    const g = new GraphRestClient(tokens, "user-1", async (url) => {
      expect(String(url)).toContain("/onlineMeetings?$top=1");
      return json(404, { error: { message: "not found" } });
    });
    try {
      await g.probeAccessPolicy();
      expect.fail("expected throw");
    } catch (err) {
      expect((err as GraphHttpError).connectorCode).toBe("policy_missing");
    }
  });
});

describe("ClientCertificateTokenProvider", () => {
  it("posts a client_assertion JWT", async () => {
    const pem = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/test-client.pem"), "utf8");
    const jwt = clientAssertionJwt({ tenantId: "t", clientId: "id", pem, nowSec: 1_700_000_000 });
    expect(jwt.split(".")).toHaveLength(3);
    const posted: string[] = [];
    const p = new ClientCertificateTokenProvider({
      tenantId: "t",
      clientId: "id",
      certificate: pem,
      fetchImpl: async (_url, init) => {
        posted.push(String(init?.body));
        return json(200, { access_token: "tok" });
      },
    });
    expect(await p.getToken()).toBe("tok");
    expect(posted[0]).toContain("client_assertion_type");
    expect(posted[0]).toContain("urn%3Aietf%3Aparams%3Aoauth%3Aclient-assertion-type%3Ajwt-bearer");
  });
});
