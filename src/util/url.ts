import { ExtractionError } from './errors.js';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

// RFC 1918, loopback, link-local ranges
const PRIVATE_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^::1$/,
  /^fc00:/i,
  /^fd/i,
  /^fe80:/i,
  /^localhost$/i,
];

export function validateUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new ExtractionError('INVALID_URL', `Invalid URL: ${input}`);
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new ExtractionError(
      'INVALID_URL',
      `Protocol not allowed: ${url.protocol} — only http: and https: are permitted`,
    );
  }

  return url;
}

export function checkSsrf(hostname: string): void {
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(hostname)) {
      throw new ExtractionError(
        'INVALID_URL',
        `Request to private/internal address blocked: ${hostname}`,
      );
    }
  }
}

export function stripTrackingParams(urlStr: string): string {
  try {
    const url = new URL(urlStr);
    const trackingParams = [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'fbclid', 'gclid', 'msclkid', 'mc_cid', 'mc_eid',
    ];
    for (const param of trackingParams) {
      url.searchParams.delete(param);
    }
    return url.toString();
  } catch {
    return urlStr;
  }
}

export function unwrapGoogleRedirect(href: string): string {
  try {
    const url = new URL(href, 'https://www.google.com');
    if (url.pathname === '/url') {
      const q = url.searchParams.get('q') || url.searchParams.get('url');
      if (q) return q;
    }
  } catch {
    // fall through
  }
  return href;
}
