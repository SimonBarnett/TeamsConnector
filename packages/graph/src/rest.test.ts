import { describe, expect, it } from "vitest";
import { ClientCredentialsTokenProvider, GraphRestClient } from "./rest.ts";

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
});
