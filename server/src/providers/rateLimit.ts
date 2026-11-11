/** Token-bucket rate limiter shared by provider adapters. */

export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private usedInWindow = 0;
  private windowStart = Date.now();

  private readonly perMinute: number;
  private readonly now: () => number;

  constructor(perMinute: number, now: () => number = Date.now) {
    this.perMinute = perMinute;
    this.now = now;
    this.capacity = Math.max(1, perMinute);
    this.tokens = this.capacity;
    this.refillPerMs = perMinute / 60_000;
    this.lastRefill = now();
  }

  /** Waits until a token is available, then consumes it. */
  async acquire(): Promise<void> {
    for (;;) {
      const t = this.now();
      const elapsed = t - this.lastRefill;
      this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
      this.lastRefill = t;
      if (t - this.windowStart >= 60_000) {
        this.windowStart = t;
        this.usedInWindow = 0;
      }
      if (this.tokens >= 1) {
        this.tokens -= 1;
        this.usedInWindow += 1;
        return;
      }
      const waitMs = Math.ceil((1 - this.tokens) / this.refillPerMs);
      await new Promise((resolve) => setTimeout(resolve, Math.max(5, Math.min(waitMs, 1_000))));
    }
  }

  /** Consumption within the current sliding minute. */
  get used(): number {
    return this.usedInWindow;
  }

  get limit(): number {
    return this.perMinute;
  }

  get resetsAt(): string {
    return new Date(this.windowStart + 60_000).toISOString();
  }
}
