/**
 * Small shared helpers for the long-running services and their startup
 * scripts: millisecond settings from the environment, and timeouts.
 */
import { logger } from './logger.js';

/**
 * A duration in ms: an integer >= min (default 1000). An invalid value stops
 * the process at startup (never NaN, which setTimeout reads as ~1ms).
 */
export function validMs(name: string, value: unknown, min = 1000): number {
  const ms = Number(value);
  if (!Number.isInteger(ms) || ms < min) {
    logger.fatal({ name, value }, `${name} must be an integer number of milliseconds >= ${min}`);
    process.exit(1);
  }
  return ms;
}

/** A duration from the environment, or the fallback when unset or empty. */
export function envMs(name: string, fallback: number, min = 1000): number {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : validMs(name, raw, min);
}

/**
 * Wait for promise, but no longer than ms. On timeout, 'reject' rejects with
 * a timeout error and 'resolve' resolves undefined (a promise that rejects
 * resolves too, in that mode). The timer is cleared either way.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: 'reject'): Promise<T>;
export function withTimeout(promise: Promise<unknown>, ms: number, onTimeout: 'resolve'): Promise<void>;
export function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: 'reject' | 'resolve'): Promise<T | void> {
  return new Promise<T | void>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (onTimeout === 'reject') reject(new Error(`timed out after ${ms}ms`));
      else resolve();
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(onTimeout === 'reject' ? value : undefined);
      },
      (error: unknown) => {
        clearTimeout(timer);
        if (onTimeout === 'reject') reject(error instanceof Error ? error : new Error(String(error)));
        else resolve();
      }
    );
  });
}
