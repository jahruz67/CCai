export class Cooldown {
  private readonly expiresAt = new Map<string, number>();

  public constructor(
    private readonly durationMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  public consume(key: string): number {
    const currentTime = this.now();
    const existingExpiry = this.expiresAt.get(key) ?? 0;

    if (existingExpiry > currentTime) {
      return existingExpiry - currentTime;
    }

    if (this.durationMs > 0) {
      this.expiresAt.set(key, currentTime + this.durationMs);
    } else {
      this.expiresAt.delete(key);
    }

    return 0;
  }

  public sweep(): number {
    const currentTime = this.now();
    let removed = 0;

    for (const [key, expiry] of this.expiresAt) {
      if (expiry <= currentTime) {
        this.expiresAt.delete(key);
        removed += 1;
      }
    }

    return removed;
  }
}
