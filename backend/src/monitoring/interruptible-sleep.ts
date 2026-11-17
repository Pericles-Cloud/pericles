/**
 * A loop's sleep that a stop request can end early, shared by the per-org and
 * global monitoring loops. Once stopped, every sleep returns at once (a stop
 * that lands mid-cycle must not be followed by a full-interval sleep), until
 * the loop is started again.
 */
export interface InterruptibleSleep {
  /** Sleep for ms, or less if stopped; returns at once while stopped. */
  sleep: (ms: number) => Promise<void>;
  /** Stop: wake the current sleep and make later sleeps return at once. */
  stop: () => void;
  /** Clear the stopped state when the loop (re)starts. */
  reset: () => void;
}

export function createInterruptibleSleep(): InterruptibleSleep {
  let stopped = false;
  let wake: (() => void) | null = null;

  return {
    sleep: (ms) =>
      new Promise<void>((resolve) => {
        if (stopped) {
          resolve();
          return;
        }
        const timer = setTimeout(done, ms);
        function done(): void {
          clearTimeout(timer);
          wake = null;
          resolve();
        }
        wake = done;
      }),
    stop: () => {
      stopped = true;
      wake?.();
    },
    reset: () => {
      stopped = false;
    },
  };
}
