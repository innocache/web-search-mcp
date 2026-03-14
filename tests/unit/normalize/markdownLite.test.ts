import { htmlToMarkdownLite } from '../../../src/normalize/markdownLite.js';

function doc(body: string): string {
  return `<html><body>${body}</body></html>`;
}

describe('htmlToMarkdownLite', () => {
  it('converts h1 through h6 tags to markdown heading levels', () => {
    const html = doc('<h1>A</h1><h2>B</h2><h3>C</h3><h4>D</h4><h5>E</h5><h6>F</h6>');

    const result = htmlToMarkdownLite(html, 1000);

    expect(result).toBe('# A\n\n## B\n\n### C\n\n#### D\n\n##### E\n\n###### F');
  });

  it('renders paragraphs separated by blank lines', () => {
    const html = doc('<p>First paragraph</p><p>Second paragraph</p>');

    const result = htmlToMarkdownLite(html, 1000);

    expect(result).toBe('First paragraph\n\nSecond paragraph');
  });

  it('converts strong and b tags to bold markdown', () => {
    const html = doc('<p><strong>Bold</strong> and <b>also bold</b></p>');

    const result = htmlToMarkdownLite(html, 1000);

    expect(result).toBe('**Bold** and **also bold**');
  });

  it('converts em and i tags to italic markdown', () => {
    const html = doc('<p><em>Italic</em> and <i>also italic</i></p>');

    const result = htmlToMarkdownLite(html, 1000);

    expect(result).toBe('*Italic* and *also italic*');
  });

  it('converts anchor tags to markdown links', () => {
    const html = doc('<p><a href="https://example.com">Example</a></p>');

    const result = htmlToMarkdownLite(html, 1000);

    expect(result).toBe('[Example](https://example.com)');
  });

  it('converts inline code tags to backtick-wrapped markdown', () => {
    const html = doc('<p>Use <code>npm test</code> now.</p>');

    const result = htmlToMarkdownLite(html, 1000);

    expect(result).toBe('Use `npm test` now.');
  });

  it('converts pre > code with language class into fenced code blocks', () => {
    const html = doc('<pre><code class="language-js">const x = 1;\nconsole.log(x);</code></pre>');

    const result = htmlToMarkdownLite(html, 1000);

    expect(result).toBe('```js\nconst x = 1;\nconsole.log(x);\n```');
  });

  it('converts unordered lists into markdown bullet lists', () => {
    const html = doc('<ul><li>Alpha</li><li>Beta</li></ul>');

    const result = htmlToMarkdownLite(html, 1000);

    expect(result).toBe('- Alpha\n- Beta');
  });

  it('converts ordered lists into numbered markdown lists', () => {
    const html = doc('<ol><li>First</li><li>Second</li></ol>');

    const result = htmlToMarkdownLite(html, 1000);

    expect(result).toBe('1. First\n2. Second');
  });

  it('converts blockquotes to markdown quote prefixes', () => {
    const html = doc('<blockquote><p>Quoted text</p></blockquote>');

    const result = htmlToMarkdownLite(html, 1000);

    expect(result).toBe('> Quoted text');
  });

  it('converts tables into markdown table syntax with separator row', () => {
    const html = doc('<table><thead><tr><th>Name</th><th>Score</th></tr></thead><tbody><tr><td>Alice</td><td>10</td></tr></tbody></table>');

    const result = htmlToMarkdownLite(html, 1000);

    expect(result).toBe('| Name | Score |\n| --- | --- |\n| Alice | 10 |');
  });

  it('converts images to markdown image syntax', () => {
    const html = doc('<img src="/img/logo.png" alt="Logo">');

    const result = htmlToMarkdownLite(html, 1000);

    expect(result).toBe('![Logo](/img/logo.png)');
  });

  it('converts horizontal rule tags to markdown separators', () => {
    const result = htmlToMarkdownLite(doc('<hr>'), 1000);

    expect(result).toBe('---');
  });

  it('truncates at a word boundary when markdown exceeds maxChars', () => {
    const html = doc('<p>alpha beta gamma delta</p>');

    const result = htmlToMarkdownLite(html, 12);

    expect(result).toBe('alpha beta');
  });

  it('returns empty string for empty html input', () => {
    const result = htmlToMarkdownLite(doc(''), 1000);

    expect(result).toBe('');
  });

  it('handles nested formatting like bold text inside links', () => {
    const html = doc('<p><a href="https://example.com"><strong>Bold</strong> Link</a></p>');

    const result = htmlToMarkdownLite(html, 1000);

    expect(result).toBe('[**Bold** Link](https://example.com)');
  });
});
