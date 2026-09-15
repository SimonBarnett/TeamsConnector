export interface MediaAdmitOpts {
  avatar: boolean;
  speak: boolean;
}

export interface PlayCommand {
  utteranceId: string;
  text: string;
  durationMs: number;
  allowBargeIn: boolean;
  priority: "normal" | "urgent";
}

export interface MediaWorker {
  healthy(): Promise<boolean>;
  admit(sessionId: string, opts: MediaAdmitOpts): Promise<{ videoSending: boolean; canHear: boolean }>;
  play(sessionId: string, cmd: PlayCommand): Promise<{ status: "playing" | "queued" }>;
  cancel(sessionId: string, utteranceId?: string): Promise<{ cancelled: string[]; stopLatencyMs: number }>;
  bargeIn(sessionId: string): Promise<{ cancelled: string[]; stopLatencyMs: number }>;
  mute(sessionId: string): Promise<{ cancelled: string[] }>;
  leave(sessionId: string): Promise<{ closeLatencyMs: number }>;
}

interface Playing {
  cmd: PlayCommand;
  startedAt: number;
}

interface SessionMedia {
  muted: boolean;
  playing?: Playing;
}

export class UnavailableMediaWorker implements MediaWorker {
  async healthy(): Promise<boolean> {
    return false;
  }
  async admit(): Promise<{ videoSending: boolean; canHear: boolean }> {
    throw new Error("media worker unavailable");
  }
  async play(): Promise<{ status: "playing" | "queued" }> {
    throw new Error("media worker unavailable");
  }
  async cancel(): Promise<{ cancelled: string[]; stopLatencyMs: number }> {
    return { cancelled: [], stopLatencyMs: 0 };
  }
  async bargeIn(): Promise<{ cancelled: string[]; stopLatencyMs: number }> {
    return { cancelled: [], stopLatencyMs: 0 };
  }
  async mute(): Promise<{ cancelled: string[] }> {
    return { cancelled: [] };
  }
  async leave(): Promise<{ closeLatencyMs: number }> {
    return { closeLatencyMs: 0 };
  }
}

/** In-process Track B stand-in: admit, TTS play, barge-in ≤ 400 ms, leave ≤ 2 s. No files. */
export class LoopbackMediaWorker implements MediaWorker {
  readonly sessions = new Map<string, SessionMedia>();
  failNextAdmits = 0;

  async healthy(): Promise<boolean> {
    return true;
  }

  async admit(sessionId: string, opts: MediaAdmitOpts): Promise<{ videoSending: boolean; canHear: boolean }> {
    if (this.failNextAdmits > 0) {
      this.failNextAdmits -= 1;
      throw new Error("media worker crash");
    }
    this.sessions.set(sessionId, { muted: false });
    return { videoSending: opts.avatar, canHear: true };
  }

  async play(sessionId: string, cmd: PlayCommand): Promise<{ status: "playing" | "queued" }> {
    const s = this.require(sessionId);
    if (s.muted) throw new Error("muted");
    if (s.playing) return { status: "queued" };
    s.playing = { cmd, startedAt: Date.now() };
    return { status: "playing" };
  }

  async cancel(sessionId: string, utteranceId?: string): Promise<{ cancelled: string[]; stopLatencyMs: number }> {
    const started = Date.now();
    const s = this.sessions.get(sessionId);
    if (!s?.playing) return { cancelled: [], stopLatencyMs: 0 };
    if (utteranceId && s.playing.cmd.utteranceId !== utteranceId) {
      return { cancelled: [], stopLatencyMs: Date.now() - started };
    }
    const id = s.playing.cmd.utteranceId;
    s.playing = undefined;
    return { cancelled: [id], stopLatencyMs: Date.now() - started };
  }

  async bargeIn(sessionId: string): Promise<{ cancelled: string[]; stopLatencyMs: number }> {
    const started = Date.now();
    const s = this.sessions.get(sessionId);
    if (!s?.playing) return { cancelled: [], stopLatencyMs: 0 };
    if (!s.playing.cmd.allowBargeIn || s.playing.cmd.priority === "urgent") {
      return { cancelled: [], stopLatencyMs: Date.now() - started };
    }
    const id = s.playing.cmd.utteranceId;
    s.playing = undefined;
    return { cancelled: [id], stopLatencyMs: Date.now() - started };
  }

  async mute(sessionId: string): Promise<{ cancelled: string[] }> {
    const s = this.require(sessionId);
    s.muted = true;
    const cancelled = s.playing ? [s.playing.cmd.utteranceId] : [];
    s.playing = undefined;
    return { cancelled };
  }

  async leave(sessionId: string): Promise<{ closeLatencyMs: number }> {
    const started = Date.now();
    this.sessions.delete(sessionId);
    return { closeLatencyMs: Date.now() - started };
  }

  private require(sessionId: string): SessionMedia {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error(`no media session ${sessionId}`);
    return s;
  }
}
