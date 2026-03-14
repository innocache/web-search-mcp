/// <reference types="vitest/globals" />

import { fixtureUrl } from './helpers.js';
import { extractUrl } from '../../src/extraction/pipeline.js';
import type { ExtractUrlOptions } from '../../src/extraction/pipeline.js';
import { loadConfig } from '../../src/util/config.js';

let electronApp: { whenReady: () => Promise<void> } | undefined;
let ElectronBrowserWindow: { getAllWindows: () => Array<{ isDestroyed: () => boolean; destroy: () => void }> } | undefined;
try {
  const electron = await import('electron');
  electronApp = electron.app;
  ElectronBrowserWindow = electron.BrowserWindow;
} catch {
  // Electron not available — tests will be skipped
}

const hasElectron = process.env['VITEST_ELECTRON'] === '1' || typeof electronApp?.whenReady === 'function';

interface FixtureExpectation {
  with: string[];
  without: string[];
  minQuality: number;
  maxQuality?: number;
  hasTitle: boolean;
  hasAuthor: boolean;
}

const expected: Record<string, FixtureExpectation> = {
  'simple-article.html': {
    with: [
      'City Transit Board Approves Overnight Service Pilot',
      'six-month overnight service pilot',
      'Blue and Green rail lines',
      'restaurant workers, hospital staff, and airport employees',
      'Board chair Elena Ruiz',
      'final recommendation before the winter budget cycle',
    ],
    without: [],
    minQuality: 65,
    hasTitle: true,
    hasAuthor: true,
  },
  'article-with-ads.html': {
    with: [
      'How Regional Newsrooms Share Climate Data',
      'regional editors now begins each morning with the same flood map',
      'common data dictionary',
      'rotating verification shift',
      'public methods page describing sourcing',
    ],
    without: [
      'cookie technology',
      'Accept cookie settings',
      'sponsor message',
      'Share on X',
      'Share on LinkedIn',
    ],
    minQuality: 55,
    hasTitle: true,
    hasAuthor: false,
  },
  'article-with-metadata.html': {
    with: [
      "Inside the Public Library's Digital Preservation Lab",
      'secured room below the main reading hall',
      'forensic disk images and run checksum validation',
      'Oral-history interviews',
      'Lab director Naomi Fields',
    ],
    without: [],
    minQuality: 65,
    hasTitle: true,
    hasAuthor: true,
  },
  'lazy-images.html': {
    with: [
      'Field Notes From the River Restoration Corridor',
      'reopening side channels',
      'temperature and dissolved oxygen every six hours',
      'more birds and fewer flooding concerns',
      'insect abundance against pre-project baselines',
    ],
    without: [],
    minQuality: 60,
    hasTitle: true,
    hasAuthor: false,
  },
  'heavy-navigation.html': {
    with: [
      'Morning Briefing: Regional Rail Update',
      'overnight switch repairs finished ahead of schedule',
      'weekend bus bridges will continue',
      'elevator access improvements',
    ],
    without: ['Classifieds', 'Privacy Policy', 'Terms of Use', 'Cookie Policy', 'TikTok', 'Mastodon'],
    minQuality: 35,
    hasTitle: true,
    hasAuthor: false,
  },
  'js-rendered.html': {
    with: [
      'Live Blog: Emergency Preparedness Drill',
      'coordinated emergency drill Tuesday morning',
      'shared incident board',
      'multilingual templates improved readability',
      'after-action memo next week',
    ],
    without: ['JavaScript is disabled', 'noscript mode'],
    minQuality: 55,
    hasTitle: true,
    hasAuthor: false,
  },
  'empty-page.html': {
    with: [],
    without: [],
    minQuality: 0,
    maxQuality: 30,
    hasTitle: false,
    hasAuthor: false,
  },
  'large-page.html': {
    with: [
      'Decade-Long Reinvention of Harbor District Transit',
      'modernize two stations',
      'Planning, Then Replanning',
      'Construction in a Changing Climate',
      'Neighborhood Effects',
      'Operational Lessons and Measured Results',
      'What Comes Next',
      'integrated fare capping',
    ],
    without: [],
    minQuality: 70,
    hasTitle: true,
    hasAuthor: false,
  },
};

const config = {
  ...loadConfig(),
  headlessMode: true,
  resourceBlockImages: true,
  resourceBlockMedia: true,
  resourceBlockFonts: true,
  defaultTimeoutMs: 30000,
  defaultSettleMs: 500,
  maxCharsDefault: 50000,
  browserConcurrency: 1,
};

const defaultOptions: ExtractUrlOptions = {
  outputFormat: 'text',
  maxChars: 50000,
  timeoutMs: 30000,
  waitUntil: 'load',
  settleMs: 1200,
};

const TEST_TIMEOUT_MS = 45000;

describe.skipIf(!hasElectron)('E2E Pipeline Extraction', () => {
  beforeAll(async () => {
    if (electronApp) {
      await electronApp.whenReady();
    }
    // When run via electron-test-main.mjs, app is already ready
  });

  afterAll(async () => {
    let BW = ElectronBrowserWindow;
    if (!BW) {
      try {
        const electron = await import('electron');
        BW = electron.BrowserWindow;
      } catch {
        // Cannot clean up windows without BrowserWindow reference
        return;
      }
    }
    for (const win of BW.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.destroy();
      }
    }
  });

  describe.each(Object.entries(expected))('fixture %s', (fixtureName, expectation) => {
    it(`extracts ${fixtureName} correctly`, async () => {
      const result = await extractUrl(fixtureUrl(fixtureName), config, defaultOptions);
      const normalized = result.textContent.toLowerCase();

      for (const phrase of expectation.with) {
        expect(normalized).toContain(phrase.toLowerCase());
      }

      for (const phrase of expectation.without) {
        expect(normalized).not.toContain(phrase.toLowerCase());
      }

      expect(result.score).toBeGreaterThanOrEqual(expectation.minQuality);
      if (typeof expectation.maxQuality === 'number') {
        expect(result.score).toBeLessThanOrEqual(expectation.maxQuality);
      }

      if (expectation.hasTitle) {
        expect(result.title).toBeTruthy();
      }

      if (expectation.hasAuthor) {
        expect(result.author).toBeTruthy();
      }
    }, TEST_TIMEOUT_MS);
  });

  it('truncates large-page.html with small maxChars', async () => {
    const result = await extractUrl(fixtureUrl('large-page.html'), config, { ...defaultOptions, maxChars: 2000 });
    expect(result.textContent.length).toBeLessThanOrEqual(2200);
    expect(result.score).toBeGreaterThanOrEqual(50);
  }, TEST_TIMEOUT_MS);

  it('returns markdown format when requested', async () => {
    const result = await extractUrl(fixtureUrl('simple-article.html'), config, {
      ...defaultOptions,
      outputFormat: 'markdown',
    });

    expect(result.content).toContain('#');
    expect(result.outputFormat).toBe('markdown');
  }, TEST_TIMEOUT_MS);

  it('returns html format when requested', async () => {
    const result = await extractUrl(fixtureUrl('simple-article.html'), config, {
      ...defaultOptions,
      outputFormat: 'html',
    });

    expect(result.content).toMatch(/<[a-z]/i);
    expect(result.outputFormat).toBe('html');
  }, TEST_TIMEOUT_MS);

  it('returns text format by default', async () => {
    const result = await extractUrl(fixtureUrl('simple-article.html'), config, defaultOptions);
    expect(result.outputFormat).toBe('text');
    expect(result.content).toBe(result.textContent);
  }, TEST_TIMEOUT_MS);

  it('blocks localhost URLs via SSRF protection', async () => {
    await expect(extractUrl('http://localhost:1234/blocked', config, defaultOptions)).rejects.toThrow(
      /private\/internal address blocked/i,
    );
  }, TEST_TIMEOUT_MS);

  it('blocks 127.0.0.1 URLs via SSRF protection', async () => {
    await expect(extractUrl('http://127.0.0.1:1234/blocked', config, defaultOptions)).rejects.toThrow(
      /private\/internal address blocked/i,
    );
  }, TEST_TIMEOUT_MS);

  it('returns fixture final URL and no readability-failure warning for article pages', async () => {
    const result = await extractUrl(fixtureUrl('article-with-metadata.html'), config, defaultOptions);
    expect(result.finalUrl).toContain('article-with-metadata.html');
    expect(result.warnings).not.toContain('READABILITY_FAILED');
  }, TEST_TIMEOUT_MS);
});
