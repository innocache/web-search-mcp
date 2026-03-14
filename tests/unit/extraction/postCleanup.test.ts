/// <reference types="vitest/globals" />

import { runPostCleanup } from '../../../src/extraction/postCleanup.js';

const asDocument = (content: string): string => `<html><body>${content}</body></html>`;

describe('runPostCleanup', () => {
  it('passes simple valid HTML through with no warnings', () => {
    const html = '<article><h1>Title</h1><p>This is meaningful content.</p></article>';
    const result = runPostCleanup(asDocument(html));

    expect(result.cleanedHtml).toContain('<article><h1>Title</h1><p>This is meaningful content.</p></article>');
    expect(result.warnings).toEqual([]);
  });

  it('removes empty p, div, and span elements', () => {
    const html = '<div><p>   </p><div></div><span> </span><p>Keep me</p></div>';
    const result = runPostCleanup(asDocument(html));

    expect(result.cleanedHtml).toContain('<p>Keep me</p>');
    expect(result.cleanedHtml).not.toContain('<span>');
    expect(result.cleanedHtml).not.toContain('<div></div>');
    expect(result.cleanedHtml).not.toContain('<p> </p>');
  });

  it('recursively removes nested empty elements', () => {
    const html = '<section><div><span> </span></div><p>Body text</p></section>';
    const result = runPostCleanup(asDocument(html));

    expect(result.cleanedHtml).toContain('<section><p>Body text</p></section>');
    expect(result.cleanedHtml).not.toContain('<span>');
    expect(result.cleanedHtml).not.toContain('<div>');
  });

  it('removes boilerplate block when multiple phrases appear in same block', () => {
    const html =
      '<article><p>All rights reserved. See our Privacy Policy for details.</p><p>Actual article text.</p></article>';
    const result = runPostCleanup(asDocument(html));

    expect(result.cleanedHtml).toContain('<p>Actual article text.</p>');
    expect(result.cleanedHtml).not.toContain('All rights reserved');
    expect(result.cleanedHtml).not.toContain('Privacy Policy');
    expect(result.warnings).toContain('BOILERPLATE_REMOVED');
  });

  it('removes boilerplate short block with a single phrase', () => {
    const html = '<div><small>Privacy Policy</small><p>Main content stays.</p></div>';
    const result = runPostCleanup(asDocument(html));

    expect(result.cleanedHtml).toContain('<p>Main content stays.</p>');
    expect(result.cleanedHtml).not.toContain('Privacy Policy');
    expect(result.warnings).toContain('BOILERPLATE_REMOVED');
  });

  it('removes link-dense small blocks and records warning', () => {
    const html =
      '<main><div><a href="/a">Alpha</a> <a href="/b">Beta</a> x</div><p>Primary content remains.</p></main>';
    const result = runPostCleanup(asDocument(html));

    expect(result.cleanedHtml).toContain('<p>Primary content remains.</p>');
    expect(result.cleanedHtml).not.toContain('href="/a"');
    expect(result.warnings).toContain('LINK_DENSE_BLOCKS_REMOVED');
  });

  it('does not remove blocks with large total text even when they include links', () => {
    const longText = 'a'.repeat(210);
    const html = `<article><div><a href="/x">linked</a>${longText}</div></article>`;
    const result = runPostCleanup(asDocument(html));

    expect(result.cleanedHtml).toContain('href="/x"');
    expect(result.warnings).not.toContain('LINK_DENSE_BLOCKS_REMOVED');
  });

  it('strips tracking parameters utm_source, fbclid, and gclid from URL text', () => {
    const html =
      '<p>Visit https://example.com/page?utm_source=campaign&fbclid=abc123&gclid=xyz789&ref=keepme now.</p>';
    const result = runPostCleanup(asDocument(html));

    expect(result.cleanedHtml).toMatch(/https:\/\/example\.com\/page\?(?:&amp;)*ref=keepme/);
    expect(result.cleanedHtml).not.toContain('utm_source=');
    expect(result.cleanedHtml).not.toContain('fbclid=');
    expect(result.cleanedHtml).not.toContain('gclid=');
  });

  it('preserves elements with meaningful img children even when text is empty', () => {
    const html = '<div><div><img src="image.jpg" alt="" /></div><p>Caption text</p></div>';
    const result = runPostCleanup(asDocument(html));

    expect(result.cleanedHtml).toContain('<img src="image.jpg" alt="">');
    expect(result.cleanedHtml).toContain('<p>Caption text</p>');
  });

  it('preserves elements with meaningful table and pre children', () => {
    const html =
      '<section><div><table><tr><td></td></tr></table></div><div><pre><code></code></pre></div></section>';
    const result = runPostCleanup(asDocument(html));

    expect(result.cleanedHtml).toContain('<table>');
    expect(result.cleanedHtml).toContain('<pre><code></code></pre>');
  });

  it('can run multiple cleanup passes without breaking structure', () => {
    const html =
      '<article><div><span> </span></div><p>All rights reserved Privacy Policy</p><section><a href="/x">Go</a> t</section><p>https://example.com?a=1&utm_source=x</p></article>';

    const firstPass = runPostCleanup(asDocument(html));
    const secondPass = runPostCleanup(asDocument(firstPass.cleanedHtml));

    expect(secondPass.cleanedHtml).toContain('<article>');
    expect(secondPass.cleanedHtml).toContain('https://example.com?a=1');
    expect(secondPass.cleanedHtml).not.toContain('utm_source=');
    expect(secondPass.cleanedHtml).not.toContain('All rights reserved');
    expect(secondPass.cleanedHtml).not.toContain('<span>');
  });

  it('includes both warning types when both removals happen', () => {
    const html =
      '<main><p>Privacy Policy and All rights reserved</p><nav><a href="/one">One</a> <a href="/two">Two</a> x</nav></main>';
    const result = runPostCleanup(asDocument(html));

    expect(result.warnings).toEqual(expect.arrayContaining(['BOILERPLATE_REMOVED', 'LINK_DENSE_BLOCKS_REMOVED']));
  });
});
