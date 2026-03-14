const CHROME_VERSIONS = ['134', '135', '136', '138', '140', '144', '146'];
const OS_STRINGS = [
  'Windows NT 10.0; Win64; x64',
  'Macintosh; Intel Mac OS X 10_15_7',
  'X11; Linux x86_64',
];

export function generateUserAgent(): string {
  const chrome = CHROME_VERSIONS[Math.floor(Math.random() * CHROME_VERSIONS.length)];
  const os = OS_STRINGS[Math.floor(Math.random() * OS_STRINGS.length)];
  return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome}.0.0.0 Safari/537.36`;
}
