/// <reference types="vitest/globals" />

import {
  validateUrl,
  checkSsrf,
  stripTrackingParams,
  unwrapGoogleRedirect,
} from '../../../src/util/url.js';
import { ExtractionError } from '../../../src/util/errors.js';

describe('validateUrl', () => {
  it('accepts valid http URL', () => {
    const url = validateUrl('http://example.com/path?x=1');

    expect(url).toBeInstanceOf(URL);
    expect(url.protocol).toBe('http:');
  });

  it('accepts valid https URL', () => {
    const url = validateUrl('https://example.com/path?x=1');

    expect(url).toBeInstanceOf(URL);
    expect(url.protocol).toBe('https:');
  });

  it('throws INVALID_URL for malformed input', () => {
    expect(() => validateUrl('not-a-url')).toThrow(ExtractionError);
    expect(() => validateUrl('not-a-url')).toThrow('Invalid URL: not-a-url');
    expect(() => validateUrl('not-a-url')).toThrow(
      expect.objectContaining({ code: 'INVALID_URL' }),
    );
  });

  it('throws INVALID_URL for non-http protocols', () => {
    expect(() => validateUrl('ftp://example.com')).toThrow(
      expect.objectContaining({ code: 'INVALID_URL' }),
    );
  });
});

describe('checkSsrf', () => {
  it('throws for blocked private and local addresses', () => {
    const blocked = [
      '127.0.0.1',
      '10.0.0.5',
      '172.16.2.1',
      '172.31.255.255',
      '192.168.1.4',
      'localhost',
      '::1',
      'fc00::1',
      'fe80::abcd',
    ];

    for (const host of blocked) {
      expect(() => checkSsrf(host)).toThrow(
        expect.objectContaining({ code: 'INVALID_URL' }),
      );
    }
  });

  it('allows normal public hostnames and ips', () => {
    const allowed = ['example.com', 'sub.domain.org', '8.8.8.8', '1.1.1.1'];

    for (const host of allowed) {
      expect(() => checkSsrf(host)).not.toThrow();
    }
  });
});

describe('stripTrackingParams', () => {
  it('removes common tracking params', () => {
    const stripped = stripTrackingParams(
      'https://example.com/page?utm_source=x&utm_medium=y&utm_campaign=z&utm_term=t&utm_content=c&fbclid=f&gclid=g&msclkid=m&mc_cid=mc1&mc_eid=mc2',
    );

    const url = new URL(stripped);
    expect(Array.from(url.searchParams.keys())).toHaveLength(0);
  });

  it('preserves non-tracking params', () => {
    const stripped = stripTrackingParams(
      'https://example.com/page?utm_source=x&keep=1&lang=en&gclid=abc',
    );

    const url = new URL(stripped);
    expect(url.searchParams.get('keep')).toBe('1');
    expect(url.searchParams.get('lang')).toBe('en');
    expect(url.searchParams.has('utm_source')).toBe(false);
    expect(url.searchParams.has('gclid')).toBe(false);
  });

  it('returns input unchanged for invalid URLs', () => {
    const input = '%%%not-a-valid-url%%%';

    expect(stripTrackingParams(input)).toBe(input);
  });
});

describe('unwrapGoogleRedirect', () => {
  it('extracts q param from google /url redirects', () => {
    const result = unwrapGoogleRedirect(
      'https://www.google.com/url?q=https%3A%2F%2Fexample.com%2Fa%3Fx%3D1&sa=U&ved=2ah',
    );

    expect(result).toBe('https://example.com/a?x=1');
  });

  it('extracts url param from google /url redirects', () => {
    const result = unwrapGoogleRedirect(
      'https://www.google.com/url?url=https%3A%2F%2Fexample.org%2Flanding&source=web',
    );

    expect(result).toBe('https://example.org/landing');
  });

  it('returns original href when not a google redirect path', () => {
    const href = 'https://www.google.com/search?q=test';

    expect(unwrapGoogleRedirect(href)).toBe(href);
  });

  it('handles invalid URLs gracefully', () => {
    const href = '://bad url';

    expect(unwrapGoogleRedirect(href)).toBe(href);
  });
});
