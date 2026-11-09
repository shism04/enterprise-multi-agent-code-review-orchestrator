import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withRetry, withTimeout, ErrorCodes, ReviewError } from '../src/utils/error-handler';

describe('withRetry', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns the result when a later attempt succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('ok');

    const p = withRetry(fn, 3, 1000);
    await vi.advanceTimersByTimeAsync(2000);

    await expect(p).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws RETRY_EXHAUSTED after maxRetries attempts', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));

    const p = withRetry(fn, 3, 1000);
    const assertion = expect(p).rejects.toMatchObject({
      code: ErrorCodes.RETRY_EXHAUSTED,
      metadata: { attempts: 3, lastError: 'always fails' }
    });
    await vi.runAllTimersAsync();

    await assertion;
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('waits exponentially between attempts and never after the last one', async () => {
    const callTimes: number[] = [];
    const fn = vi.fn(async () => {
      callTimes.push(Date.now());
      throw new Error('x');
    });

    const p = withRetry(fn, 3, 1000);
    const assertion = expect(p).rejects.toMatchObject({ code: ErrorCodes.RETRY_EXHAUSTED });
    await vi.runAllTimersAsync();
    await assertion;

    expect(callTimes).toHaveLength(3);
    const [gap1, gap2] = [callTimes[1]! - callTimes[0]!, callTimes[2]! - callTimes[1]!];
    // Backoff = delayMs * 2^(attempt-1) plus 0-100ms jitter
    expect(gap1).toBeGreaterThanOrEqual(1000);
    expect(gap1).toBeLessThan(1100);
    expect(gap2).toBeGreaterThanOrEqual(2000);
    expect(gap2).toBeLessThan(2100);
    // No timer left after the final failure
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not retry errors the predicate rejects, and rethrows them unchanged', async () => {
    const original = new ReviewError('bad output', ErrorCodes.STRUCTURED_OUTPUT_FAILED);
    const fn = vi.fn().mockRejectedValue(original);

    await expect(withRetry(fn, 3, 1000, undefined, () => false)).rejects.toBe(original);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('rejects maxRetries < 1 with INVALID_CONFIG', async () => {
    await expect(withRetry(async () => 1, 0, 1000)).rejects.toMatchObject({
      code: ErrorCodes.INVALID_CONFIG
    });
  });

  it('stops retrying when the signal is already aborted', async () => {
    const controller = new AbortController();
    const fn = vi.fn().mockImplementation(async () => {
      controller.abort();
      throw new Error('cancelled');
    });

    const p = withRetry(fn, 3, 1000, controller.signal);
    const assertion = expect(p).rejects.toThrow('cancelled');
    await vi.runAllTimersAsync();

    await assertion;
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('withTimeout', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns the value when fn finishes before the timeout', async () => {
    const result = await withTimeout(async () => 42, 5000);
    expect(result).toBe(42);
  });

  it('rejects with AGENT_TIMEOUT when fn never resolves', async () => {
    const p = withTimeout(() => new Promise<never>(() => {}), 5000, 'too slow');
    const assertion = expect(p).rejects.toMatchObject({
      code: ErrorCodes.AGENT_TIMEOUT,
      message: 'too slow',
      metadata: { timeoutMs: 5000 }
    });
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
  });

  it('aborts the signal given to fn when the timeout fires', async () => {
    let received: AbortSignal | undefined;
    const p = withTimeout((signal) => {
      received = signal;
      return new Promise<never>(() => {});
    }, 1000);
    const assertion = expect(p).rejects.toBeInstanceOf(ReviewError);

    expect(received?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(received?.aborted).toBe(true);
    await assertion;
  });

  it('clears its timer when fn finishes early', async () => {
    await withTimeout(async () => 'fast', 60_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects timeoutMs < 1 with INVALID_CONFIG', async () => {
    await expect(withTimeout(async () => 1, 0)).rejects.toMatchObject({
      code: ErrorCodes.INVALID_CONFIG
    });
  });
});
