import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimiter } from '../src/utils/rate-limiter';

describe('RateLimiter', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('blocks a third concurrent request until one is released', async () => {
    const limiter = new RateLimiter({ maxConcurrent: 2, maxRequestsPerMinute: 100, maxTokensPerMinute: 1_000_000 });
    await limiter.acquire(10);
    await limiter.acquire(10);

    let third = false;
    const p = limiter.acquire(10).then(() => { third = true; });

    await vi.advanceTimersByTimeAsync(1000);
    expect(third).toBe(false);

    limiter.release();
    await p;
    expect(third).toBe(true);
    expect(limiter.getStatus().activeRequests).toBe(2);
  });

  it('frees the request window after 60 seconds', async () => {
    const limiter = new RateLimiter({ maxRequestsPerMinute: 2, maxConcurrent: 10, maxTokensPerMinute: 1_000_000 });
    await limiter.acquire(1);
    limiter.release();
    await limiter.acquire(1);
    limiter.release();

    expect(limiter.canProceed(1)).toBe(false);
    await vi.advanceTimersByTimeAsync(60_001);
    expect(limiter.canProceed(1)).toBe(true);
    expect(limiter.getStatus().requestsInWindow).toBe(0);
  });

  it('enforces the token budget inside the sliding window', async () => {
    const limiter = new RateLimiter({ maxTokensPerMinute: 100, maxRequestsPerMinute: 50, maxConcurrent: 10 });
    await limiter.acquire(80);
    limiter.release();

    expect(limiter.canProceed(30)).toBe(false);
    expect(limiter.canProceed(20)).toBe(true);
  });

  it('rejects a single request larger than the token limit', async () => {
    const limiter = new RateLimiter({ maxTokensPerMinute: 100 });
    await expect(limiter.acquire(101)).rejects.toThrow(/exceeds maxTokensPerMinute/);
  });

  it('prunes records older than 60 seconds', async () => {
    const limiter = new RateLimiter();
    await limiter.acquire(5);
    limiter.release();
    await vi.advanceTimersByTimeAsync(61_000);
    expect(limiter.getStatus().requestsInWindow).toBe(0);
  });
});
