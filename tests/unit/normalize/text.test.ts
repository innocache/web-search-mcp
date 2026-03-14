import { normalizeText } from '../../../src/normalize/text.js';

describe('normalizeText', () => {
  it('collapses horizontal whitespace into single spaces', () => {
    const result = normalizeText('alpha   \t\t   beta', 100);

    expect(result).toBe('alpha beta');
  });

  it('collapses runs of 3+ newlines into exactly two newlines', () => {
    const result = normalizeText('first\n\n\n\nsecond', 100);

    expect(result).toBe('first\n\nsecond');
  });

  it('applies NFKC normalization for compatibility characters', () => {
    const result = normalizeText('ﬁ ½', 100);

    expect(result).toBe('fi 1⁄2');
  });

  it('truncates at a word boundary when content exceeds maxChars', () => {
    const result = normalizeText('alpha beta gamma', 11);

    expect(result).toBe('alpha beta');
  });

  it('returns empty string on truncation when no whitespace boundary exists', () => {
    const result = normalizeText('supercalifragilistic', 5);

    expect(result).toBe('');
  });

  it('returns empty string when maxChars is 0', () => {
    const result = normalizeText('anything', 0);

    expect(result).toBe('');
  });

  it('keeps content intact when already shorter than maxChars', () => {
    const result = normalizeText('short content', 100);

    expect(result).toBe('short content');
  });

  it('trims leading and trailing whitespace across lines', () => {
    const result = normalizeText('  hello world  \n  line two   ', 100);

    expect(result).toBe('hello world\nline two');
  });

  it('uses the last available whitespace before limit when truncating', () => {
    const result = normalizeText('aa bb ccdd ee', 9);

    expect(result).toBe('aa bb');
  });
});
