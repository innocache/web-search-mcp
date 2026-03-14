import { parseHTML } from 'linkedom';

import { cleanHtml } from '../../../src/normalize/html.js';

function doc(body: string): string {
  return `<html><body>${body}</body></html>`;
}

describe('cleanHtml', () => {
  it('preserves src, href, alt, and title attributes', () => {
    const html = doc('<a href="https://example.com" title="Home" class="nav">Visit</a><img src="/logo.png" alt="Logo" title="Brand" id="hero">');

    const result = cleanHtml(html, 1000);

    expect(result).toBe('<a href="https://example.com" title="Home">Visit</a><img src="/logo.png" alt="Logo" title="Brand">');
  });

  it('removes class, id, and style attributes from elements', () => {
    const html = doc('<div class="wrap" id="main" style="color:red"><span class="inner" style="font-weight:bold">Text</span></div>');

    const result = cleanHtml(html, 1000);

    expect(result).toBe('<div><span>Text</span></div>');
  });

  it('removes data-* attributes', () => {
    const html = doc('<button data-track="cta" data-id="123" title="Save">Save</button>');

    const result = cleanHtml(html, 1000);

    expect(result).toBe('<button title="Save">Save</button>');
  });

  it('preserves table-specific colspan, rowspan, and headers attributes', () => {
    const html = doc('<table><tr><th id="h1">Name</th><td colspan="2" rowspan="3" headers="h1" class="cell">Alice</td></tr></table>');

    const result = cleanHtml(html, 1000);

    expect(result).toBe('<table><tr><th>Name</th><td colspan="2" rowspan="3" headers="h1">Alice</td></tr></table>');
  });

  it('truncates html at safe tag boundaries when maxChars is exceeded', () => {
    const html = doc('<p>alpha</p><p>beta</p><p>gamma</p>');

    const result = cleanHtml(html, 20);

    expect(result.length).toBeLessThanOrEqual(20);
    expect(result.includes('<p>be')).toBe(false);
    expect(parseHTML(`<html><body>${result}</body></html>`).document.body.innerHTML).toBe(result);
  });

  it('returns empty string when maxChars is 0', () => {
    const result = cleanHtml(doc('<p>content</p>'), 0);

    expect(result).toBe('');
  });

  it('returns unchanged html when content is under maxChars', () => {
    const html = doc('<p>Plain <em>text</em>.</p>');

    const result = cleanHtml(html, 1000);

    expect(result).toBe('<p>Plain <em>text</em>.</p>');
  });

  it('cleans complex nested html while preserving semantic attributes', () => {
    const html = doc('<section class="outer" data-testid="wrap"><a href="/docs" class="link"><img src="/img.png" alt="Diagram" style="width:20px" data-meta="x"></a><table id="t"><tr><td headers="h1" colspan="2" rowspan="1" class="cell" style="padding:0">V</td></tr></table></section>');

    const result = cleanHtml(html, 1000);

    expect(result).toBe('<section><a href="/docs"><img src="/img.png" alt="Diagram"></a><table><tr><td headers="h1" colspan="2" rowspan="1">V</td></tr></table></section>');
  });

  it('falls back to truncating on whitespace for plain text content', () => {
    const result = cleanHtml(doc('alpha beta gamma'), 10);

    expect(result).toBe('alpha');
  });
});
