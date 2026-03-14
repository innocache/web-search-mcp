import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';

import {
  detectSerpBlock,
  parseGoogleSerp,
} from '../../../src/search/parsers/googleSerpParser.js';

type ParserDocument = Parameters<typeof parseGoogleSerp>[0];

function createDocument(
  html: string,
  href = 'https://www.google.com/search?q=test',
): ParserDocument {
  const { document } = parseHTML(html);
  Object.assign(document, { location: { href } });
  return document as unknown as ParserDocument;
}

function readFixture(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

const GOOGLE_RESULTS_FIXTURE = readFixture('../../fixtures/serp/google-results.html');
const GOOGLE_BLOCKED_FIXTURE = readFixture('../../fixtures/serp/google-blocked.html');

describe('parseGoogleSerp', () => {
  it('parses five organic results from the SERP fixture and ignores ad and navigation links', () => {
    const document = createDocument(GOOGLE_RESULTS_FIXTURE);

    const results = parseGoogleSerp(document);

    expect(results).toHaveLength(5);
    expect(results.map((result) => result.position)).toEqual([1, 2, 3, 4, 5]);
    expect(results.every((result) => result.isAd === false)).toBe(true);
  });

  it('extracts title, external URL, display URL, and snippet fields', () => {
    const document = createDocument(GOOGLE_RESULTS_FIXTURE);

    const [firstResult] = parseGoogleSerp(document);

    expect(firstResult.title).toBe('Guide to Building Reliable Search Parsers');
    expect(firstResult.url).toBe('https://example.com/guide-to-parsers');
    expect(firstResult.displayUrl).toBe('example.com/guide-to-parsers');
    expect(firstResult.snippet).toBeDefined();
    expect((firstResult.snippet ?? '').length).toBeGreaterThanOrEqual(40);
  });

  it('unwraps Google redirect URLs from /url?q=... format', () => {
    const document = createDocument(GOOGLE_RESULTS_FIXTURE);

    const results = parseGoogleSerp(document);

    expect(results[1]?.url).toBe('https://news.example.org/analysis/serp-layout-changes');
  });

  it('skips anchors that do not have an h3 title', () => {
    const html = `
      <main>
        <a href="https://example.com/no-heading"><span>Missing heading</span></a>
        <a href="https://example.com/with-heading"><h3>Valid heading</h3></a>
      </main>
    `;

    const results = parseGoogleSerp(createDocument(html));

    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe('Valid heading');
  });

  it('skips anchors with missing, hash, and javascript href values', () => {
    const html = `
      <main>
        <a><h3>No href</h3></a>
        <a href="#"><h3>Hash href</h3></a>
        <a href="javascript:void(0)"><h3>Javascript href</h3></a>
        <a href="https://example.com/ok"><h3>Allowed href</h3></a>
      </main>
    `;

    const results = parseGoogleSerp(createDocument(html));

    expect(results).toHaveLength(1);
    expect(results[0]?.url).toBe('https://example.com/ok');
  });

  it('skips Google internal URLs such as search, preferences, advanced search, and setprefs', () => {
    const html = `
      <main>
        <a href="/search?q=test"><h3>Internal search</h3></a>
        <a href="https://www.google.com/preferences"><h3>Preferences</h3></a>
        <a href="https://www.google.com/advanced_search"><h3>Advanced search</h3></a>
        <a href="https://www.google.com/setprefs?sig=abc"><h3>Set prefs</h3></a>
        <a href="https://example.com/public"><h3>Public result</h3></a>
      </main>
    `;

    const results = parseGoogleSerp(createDocument(html));

    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe('Public result');
  });

  it('skips ad results when aria-label contains sponsored', () => {
    const html = `
      <main>
        <div>
          <span aria-label="Sponsored result">Sponsored</span>
          <a href="https://ads.example.com/product"><h3>Promoted product</h3></a>
        </div>
        <div>
          <a href="https://example.com/article"><h3>Organic article</h3></a>
        </div>
      </main>
    `;

    const results = parseGoogleSerp(createDocument(html));

    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe('Organic article');
  });

  it('skips ad results when badge text says Ad, Ads, or Sponsored', () => {
    const html = `
      <main>
        <div>
          <span>Ad</span>
          <a href="https://ads.example.com/ad"><h3>Ad one</h3></a>
        </div>
        <div>
          <div>Sponsored</div>
          <a href="https://ads.example.com/sponsored"><h3>Ad two</h3></a>
        </div>
        <div>
          <label>Ads</label>
          <a href="https://ads.example.com/ads"><h3>Ad three</h3></a>
        </div>
        <div>
          <a href="https://example.com/real"><h3>Real result</h3></a>
        </div>
      </main>
    `;

    const results = parseGoogleSerp(createDocument(html));

    expect(results).toHaveLength(1);
    expect(results[0]?.url).toBe('https://example.com/real');
  });

  it('extracts snippets from nearby sibling blocks with long text', () => {
    const html = `
      <main>
        <div class="wrapper">
          <div class="title-row">
            <a href="https://example.com/nearby"><h3>Nearby snippet extraction</h3></a>
          </div>
          <div class="snippet-row">
            <span>
              This snippet lives in a sibling block and is intentionally long enough to satisfy the
              parser threshold for extraction from nearby nodes.
            </span>
          </div>
        </div>
      </main>
    `;

    const [result] = parseGoogleSerp(createDocument(html));

    expect(result?.snippet).toContain('sibling block');
  });

  it('extracts display URL from a cite element in parent container when needed', () => {
    const html = `
      <main>
        <article>
          <div class="result-link">
            <a href="https://example.com/parent-cite"><h3>Parent cite extraction</h3></a>
          </div>
          <cite>example.com/parent-cite</cite>
        </article>
      </main>
    `;

    const [result] = parseGoogleSerp(createDocument(html));

    expect(result?.displayUrl).toBe('example.com/parent-cite');
  });

  it('numbers positions by valid results only when invalid entries are mixed in', () => {
    const html = `
      <main>
        <a href="https://example.com/one"><h3>One</h3></a>
        <a href="#"><h3>Invalid hash</h3></a>
        <a href="https://www.google.com/search?q=two"><h3>Internal</h3></a>
        <a href="https://example.com/two"><h3>Two</h3></a>
      </main>
    `;

    const results = parseGoogleSerp(createDocument(html));

    expect(results).toHaveLength(2);
    expect(results[0]?.position).toBe(1);
    expect(results[1]?.position).toBe(2);
  });

  it('returns an empty array for an empty SERP page', () => {
    const results = parseGoogleSerp(createDocument('<html><body></body></html>'));

    expect(results).toEqual([]);
  });
});

describe('detectSerpBlock', () => {
  it('returns null for a normal SERP fixture page', () => {
    const document = createDocument(GOOGLE_RESULTS_FIXTURE);

    expect(detectSerpBlock(document)).toBeNull();
  });

  it('detects /sorry/ URLs as anti-bot pages', () => {
    const document = createDocument(
      '<html><body><p>Please continue</p></body></html>',
      'https://www.google.com/sorry/index?continue=https://www.google.com/search?q=test',
    );

    expect(detectSerpBlock(document)).toContain('/sorry/');
  });

  it('detects reCAPTCHA iframe presence', () => {
    const document = createDocument(
      '<html><body><iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe></body></html>',
    );

    expect(detectSerpBlock(document)).toBe('Google reCAPTCHA challenge detected');
  });

  it('detects CAPTCHA form fields and sorry form actions', () => {
    const document = createDocument(
      '<html><body><form action="/sorry/index"><input name="captcha" /></form></body></html>',
    );

    expect(detectSerpBlock(document)).toBe('Google CAPTCHA form detected');
  });

  it('detects body text block signals such as unusual traffic', () => {
    const document = createDocument(
      '<html><body><p>Our systems have detected unusual traffic from your network.</p></body></html>',
    );

    expect(detectSerpBlock(document)).toBe(
      'Google block/rate-limit signal detected: unusual traffic',
    );
  });

  it('detects blocked fixture content that includes recaptcha references and challenge text', () => {
    const document = createDocument(
      GOOGLE_BLOCKED_FIXTURE,
      'https://www.google.com/sorry/index?continue=https://www.google.com/search?q=blocked',
    );

    expect(detectSerpBlock(document)).toContain('/sorry/');
  });
});
