// @vitest-environment jsdom
/// <reference types="vitest/globals" />

import { waitForPageSettled, buildPageSettlerScript, type PageSettleOptions } from '../../../src/extraction/pageSettler.js';

function makeOptions(overrides: Partial<PageSettleOptions> = {}): PageSettleOptions {
  return {
    mode: 'load',
    maxWaitMs: 1800,
    stabilityMs: 300,
    pollIntervalMs: 100,
    minTextLength: 200,
    fastPathThreshold: 3000,
    idleMs: 500,
    minWaitMs: 0,
    ...overrides,
  };
}

describe('pageSettler', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('returns precheck when initial text passes fast-path threshold', async () => {
    document.body.textContent = 'x'.repeat(3500);

    const result = await waitForPageSettled(makeOptions());

    expect(result.reason).toBe('precheck');
    expect(result.waitedMs).toBe(0);
    expect(result.textLength).toBeGreaterThanOrEqual(3000);
  });

  it('stabilizes after delayed content injection', async () => {
    setTimeout(() => {
      document.body.textContent = 'A'.repeat(260);
    }, 500);

    const result = await waitForPageSettled(makeOptions({ maxWaitMs: 2200 }));

    expect(result.reason).toBe('stabilized');
    expect(result.waitedMs).toBeGreaterThanOrEqual(500);
    expect(result.textLength).toBeGreaterThanOrEqual(200);
  });

  it('times out when content never reaches minimum threshold', async () => {
    const maxWaitMs = 450;
    const result = await waitForPageSettled(makeOptions({ maxWaitMs, pollIntervalMs: 60 }));

    expect(result.reason).toBe('timeout');
    expect(result.waitedMs).toBeGreaterThanOrEqual(400);
    expect(result.waitedMs).toBeLessThan(900);
  });

  it('waits for quiet window after incremental mutations', async () => {
    setTimeout(() => {
      document.body.textContent = 'B'.repeat(220);
    }, 200);

    setTimeout(() => {
      document.body.textContent = 'B'.repeat(320);
    }, 450);

    const result = await waitForPageSettled(makeOptions({ maxWaitMs: 2400 }));

    expect(result.reason).toBe('stabilized');
    expect(result.waitedMs).toBeGreaterThanOrEqual(750);
    expect(result.textLength).toBeGreaterThanOrEqual(300);
  });

  it('buildPageSettlerScript returns executable script string', () => {
    const script = buildPageSettlerScript(makeOptions());

    expect(script.startsWith('(')).toBe(true);
    expect(script).toContain('waitForPageSettled');
  });

  it('respects minWaitMs before declaring stabilized', async () => {
    document.body.textContent = 'C'.repeat(300);

    const result = await waitForPageSettled(
      makeOptions({ minWaitMs: 600, maxWaitMs: 2000 }),
    );

    expect(result.reason).toBe('stabilized');
    expect(result.waitedMs).toBeGreaterThanOrEqual(600);
  });

  it('does not fast-path on SPA shell text below threshold', async () => {
    document.body.textContent = 'x'.repeat(650);

    const result = await waitForPageSettled(makeOptions({ maxWaitMs: 800 }));

    expect(result.reason).not.toBe('precheck');
  });
});
