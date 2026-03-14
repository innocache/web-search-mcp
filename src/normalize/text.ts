function truncateAtWordBoundary(value: string, maxChars: number): string {
  if (maxChars <= 0) {
    return '';
  }
  if (value.length <= maxChars) {
    return value;
  }

  const chunk = value.slice(0, maxChars);
  const nextChar = value.charAt(maxChars);
  if (nextChar === '' || /\s/.test(nextChar)) {
    return chunk.trimEnd();
  }

  const lastWhitespace = Math.max(
    chunk.lastIndexOf(' '),
    chunk.lastIndexOf('\n'),
    chunk.lastIndexOf('\r'),
    chunk.lastIndexOf('\t'),
  );

  if (lastWhitespace <= 0) {
    return '';
  }

  return chunk.slice(0, lastWhitespace).trimEnd();
}

export function normalizeText(textContent: string, maxChars: number): string {
  const normalized = textContent
    .normalize('NFKC')
    .replace(/[^\S\r\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();

  return truncateAtWordBoundary(normalized, maxChars);
}
