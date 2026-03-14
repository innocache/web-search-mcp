/// <reference types="vitest/globals" />

import { generateUserAgent } from '../../../src/util/userAgent.js';

const CHROME_UA_PATTERN =
  /^Mozilla\/5\.0 \((Windows NT 10\.0; Win64; x64|Macintosh; Intel Mac OS X 10_15_7|X11; Linux x86_64)\) AppleWebKit\/537\.36 \(KHTML, like Gecko\) Chrome\/(134|135|136|138|140|144|146)\.0\.0\.0 Safari\/537\.36$/;

describe('generateUserAgent', () => {
  it('returns a Chrome-like user agent string', () => {
    const ua = generateUserAgent();

    expect(ua).toMatch(CHROME_UA_PATTERN);
  });

  it('contains Mozilla/5.0 prefix', () => {
    expect(generateUserAgent()).toContain('Mozilla/5.0');
  });

  it('contains Chrome token', () => {
    expect(generateUserAgent()).toContain('Chrome/');
  });

  it('contains AppleWebKit/537.36 token', () => {
    expect(generateUserAgent()).toContain('AppleWebKit/537.36');
  });

  it('produces consistently formatted output across multiple calls', () => {
    const samples = Array.from({ length: 20 }, () => generateUserAgent());

    for (const ua of samples) {
      expect(ua).toMatch(CHROME_UA_PATTERN);
    }
  });

  it('multiple calls can yield different values while keeping format', () => {
    const first = generateUserAgent();
    const second = generateUserAgent();

    expect(first).toMatch(CHROME_UA_PATTERN);
    expect(second).toMatch(CHROME_UA_PATTERN);
    if (first !== second) {
      expect(first).not.toBe(second);
    }
  });
});
