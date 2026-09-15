import type { MediaAdmitOpts, MediaWorker, PlayCommand } from "./media-loopback.ts";

async function json<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!res.ok) throw new Error(`media worker ${res.status}: ${text.slice(0, 400)}`);
  return text ? (JSON.parse(text) as T) : ({} as T);
}

/** Node client for the Windows Graph calling worker. */
export class HttpMediaWorker implements MediaWorker {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private url(path: string): string {
    return `${this.baseUrl.replace(/\/$/, "")}${path}`;
  }

  async healthy(): Promise<boolean> {
    try {
      const res = await this.fetchImpl(this.url("/health"));
      if (!res.ok) return false;
      const body = (await res.json()) as { healthy?: boolean };
      return body.healthy === true;
    } catch {
      return false;
    }
  }

  async admit(sessionId: string, opts: MediaAdmitOpts): Promise<{ videoSending: boolean; canHear: boolean }> {
    const res = await this.fetchImpl(this.url("/admit"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, ...opts }),
    });
    return json(res);
  }

  async play(sessionId: string, cmd: PlayCommand): Promise<{ status: "playing" | "queued" }> {
    const res = await this.fetchImpl(this.url("/play"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, ...cmd }),
    });
    return json(res);
  }

  async cancel(sessionId: string, utteranceId?: string): Promise<{ cancelled: string[]; stopLatencyMs: number }> {
    const res = await this.fetchImpl(this.url("/cancel"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, utteranceId }),
    });
    return json(res);
  }

  async bargeIn(sessionId: string): Promise<{ cancelled: string[]; stopLatencyMs: number }> {
    const res = await this.fetchImpl(this.url("/barge-in"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
    return json(res);
  }

  async mute(sessionId: string): Promise<{ cancelled: string[] }> {
    const res = await this.fetchImpl(this.url("/mute"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
    return json(res);
  }

  async leave(sessionId: string): Promise<{ closeLatencyMs: number }> {
    const res = await this.fetchImpl(this.url("/leave"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
    return json(res);
  }
}
