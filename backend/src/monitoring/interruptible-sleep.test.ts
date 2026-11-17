import { describe, it, expect, vi } from 'vitest';
import { createInterruptibleSleep } from './interruptible-sleep.js';

describe('createInterruptibleSleep', () => {
  it('stop() ends the current sleep at once', async () => {
    vi.useFakeTimers();
    try {
      const s = createInterruptibleSleep();
      let done = false;
      void s.sleep(300_000).then(() => (done = true));
      s.stop();
      await vi.advanceTimersByTimeAsync(0);
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a stop that lands mid-cycle makes the next sleep return at once', async () => {
    vi.useFakeTimers();
    try {
      const s = createInterruptibleSleep();
      s.stop(); // no sleep in progress (the loop is mid-cycle)
      let done = false;
      void s.sleep(300_000).then(() => (done = true));
      await vi.advanceTimersByTimeAsync(0);
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reset() restores normal sleeping when the loop starts again', async () => {
    vi.useFakeTimers();
    try {
      const s = createInterruptibleSleep();
      s.stop();
      s.reset();
      let done = false;
      void s.sleep(1000).then(() => (done = true));
      await vi.advanceTimersByTimeAsync(999);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
