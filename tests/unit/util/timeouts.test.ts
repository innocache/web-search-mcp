/// <reference types="vitest/globals" />

import { vi } from 'vitest';
import { withTimeout, delay, randomDelay } from '../../../src/util/timeouts.js';

describe('withTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('resolves when promise settles before timeout', async () => {
    const resultPromise = withTimeout(Promise.resolve('ok'), 1000, 'timed out');

    await expect(resultPromise).resolves.toBe('ok');
  });

  it('rejects with LOAD_TIMEOUT when timeout fires first', async () => {
    const never = new Promise<string>(() => {
      return;
    });
    const resultPromise = withTimeout(never, 100, 'page load exceeded');

    vi.advanceTimersByTime(100);

    await expect(resultPromise).rejects.toMatchObject({
      code: 'LOAD_TIMEOUT',
      message: 'page load exceeded',
    });
  });

  it('rejects with original error when wrapped promise rejects first', async () => {
    const original = new Error('network unavailable');
    const resultPromise = withTimeout(Promise.reject(original), 1000, 'timed out');

    await expect(resultPromise).rejects.toBe(original);
  });
});

describe('delay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves after specified milliseconds', async () => {
    let done = false;
    const p = delay(10).then(() => {
      done = true;
    });

    vi.advanceTimersByTime(9);
    await Promise.resolve();
    expect(done).toBe(false);

    vi.advanceTimersByTime(1);
    await p;
    expect(done).toBe(true);
  });
});

describe('randomDelay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('resolves within expected range', async () => {
    let done = false;
    const p = randomDelay(20, 30).then(() => {
      done = true;
    });

    vi.advanceTimersByTime(19);
    await Promise.resolve();
    expect(done).toBe(false);

    vi.advanceTimersByTime(11);
    await p;
    expect(done).toBe(true);
  });

  it('uses deterministic minimum delay when random is 0', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    let done = false;
    const p = randomDelay(50, 100).then(() => {
      done = true;
    });

    vi.advanceTimersByTime(49);
    await Promise.resolve();
    expect(done).toBe(false);

    vi.advanceTimersByTime(1);
    await p;
    expect(done).toBe(true);
  });

  it('can produce maximum delay when random is near 1', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    let done = false;
    const p = randomDelay(50, 100).then(() => {
      done = true;
    });

    vi.advanceTimersByTime(99);
    await Promise.resolve();
    expect(done).toBe(false);

    vi.advanceTimersByTime(1);
    await p;
    expect(done).toBe(true);
  });
});
