export class Metrics {
  private readonly counters = new Map<string, number>();
  private readonly sums = new Map<string, number>();
  private readonly counts = new Map<string, number>();

  inc(name: string, n = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + n);
  }

  observe(name: string, ms: number): void {
    this.sums.set(name, (this.sums.get(name) ?? 0) + ms);
    this.counts.set(name, (this.counts.get(name) ?? 0) + 1);
  }

  get(name: string): number {
    return this.counters.get(name) ?? 0;
  }

  renderPrometheus(): string {
    const lines: string[] = [];
    for (const [k, v] of [...this.counters.entries()].sort()) {
      lines.push(`# TYPE ${k} counter`, `${k} ${v}`);
    }
    for (const [k, sum] of [...this.sums.entries()].sort()) {
      const n = this.counts.get(k) ?? 1;
      lines.push(`# TYPE ${k}_ms summary`, `${k}_ms_sum ${sum}`, `${k}_ms_count ${n}`);
    }
    return lines.join("\n") + "\n";
  }
}
