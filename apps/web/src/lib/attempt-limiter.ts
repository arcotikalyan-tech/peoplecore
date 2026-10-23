/**
 * Counts failures per key over a sliding window: after `max` failures within `windowMs`, the key waits until the oldest
 * of them leaves the window. Held in memory (the website runs as one server process; a restart clears it).
 */
export class AttemptLimiter {
  private readonly failures = new Map<string, number[]>();

  constructor(private readonly max: number, private readonly windowMs: number, private readonly now: () => number = Date.now) {}

  /** Milliseconds until the key may try again; 0 when it may now. */
  waitFor(key: string): number {
    const recent = this.recent(key);
    return recent.length >= this.max ? Math.max(0, recent[recent.length - this.max]! + this.windowMs - this.now()) : 0;
  }

  fail(key: string): void {
    this.failures.set(key, [...this.recent(key), this.now()]);
    if (this.failures.size > 10_000) this.sweep();
  }

  clear(key: string): void {
    this.failures.delete(key);
  }

  private recent(key: string): number[] {
    const since = this.now() - this.windowMs;
    return (this.failures.get(key) ?? []).filter((t) => t > since);
  }

  private sweep(): void {
    for (const key of [...this.failures.keys()]) {
      const recent = this.recent(key);
      if (recent.length > 0) this.failures.set(key, recent);
      else this.failures.delete(key);
    }
  }
}

/** A wait as people say it, rounded up: "1 minute", "12 minutes". */
export function minutesText(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}
