export class ConcurrencyLimiter {
  private active = 0;

  public constructor(private readonly maximum: number) {
    if (!Number.isInteger(maximum) || maximum < 1) {
      throw new Error("Maximum concurrency must be a positive integer.");
    }
  }

  public tryAcquire(): (() => void) | undefined {
    if (this.active >= this.maximum) {
      return undefined;
    }

    this.active += 1;
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this.active -= 1;
    };
  }

  public activeCount(): number {
    return this.active;
  }
}
