/// <reference types="vitest/globals" />

import {
  computeExtractionScore,
  getScoreLabel,
  isWeakExtraction,
} from '../../../src/extraction/qualityScore.js';

describe('computeExtractionScore', () => {
  it('returns a near-maximum score for excellent long-form content', () => {
    const score = computeExtractionScore({
      textLength: 6200,
      sentenceCount: 80,
      linkDensity: 0.08,
      boilerplateHits: 0,
      hasTitle: true,
      hasByline: true,
      hasExcerpt: true,
      hasDate: true,
      readabilitySucceeded: true,
    });

    expect(score).toBe(100);
  });

  it('returns very low score for empty content', () => {
    const score = computeExtractionScore({
      textLength: 0,
      sentenceCount: 0,
      linkDensity: 0,
      boilerplateHits: 0,
      hasTitle: false,
      hasByline: false,
      hasExcerpt: false,
      hasDate: false,
      readabilitySucceeded: false,
    });

    expect(score).toBe(0);
  });

  it('returns very low score for minimal content under 50 chars', () => {
    const score = computeExtractionScore({
      textLength: 49,
      sentenceCount: 1,
      linkDensity: 0,
      boilerplateHits: 0,
      hasTitle: false,
      hasByline: false,
      hasExcerpt: false,
      hasDate: false,
      readabilitySucceeded: false,
    });

    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThan(30);
  });

  it('applies high link density penalty when link density is above 0.5', () => {
    const baseParams = {
      textLength: 1200,
      sentenceCount: 40,
      boilerplateHits: 0,
      hasTitle: false,
      hasByline: false,
      hasExcerpt: false,
      hasDate: false,
      readabilitySucceeded: false,
    };

    const scoreNoPenalty = computeExtractionScore({ ...baseParams, linkDensity: 0.1 });
    const scoreHighPenalty = computeExtractionScore({ ...baseParams, linkDensity: 0.51 });

    expect(scoreNoPenalty - scoreHighPenalty).toBe(20);
  });

  it('applies a capped boilerplate penalty at 5 hits', () => {
    const baseParams = {
      textLength: 1200,
      sentenceCount: 40,
      linkDensity: 0.05,
      hasTitle: false,
      hasByline: false,
      hasExcerpt: false,
      hasDate: false,
      readabilitySucceeded: false,
    };

    const score0Hits = computeExtractionScore({ ...baseParams, boilerplateHits: 0 });
    const score1Hit = computeExtractionScore({ ...baseParams, boilerplateHits: 1 });
    const score3Hits = computeExtractionScore({ ...baseParams, boilerplateHits: 3 });
    const score5Hits = computeExtractionScore({ ...baseParams, boilerplateHits: 5 });
    const score7Hits = computeExtractionScore({ ...baseParams, boilerplateHits: 7 });

    expect(score0Hits - score1Hit).toBe(3);
    expect(score0Hits - score3Hits).toBe(9);
    expect(score0Hits - score5Hits).toBe(15);
    expect(score5Hits).toBe(score7Hits);
  });

  it('clamps score to 0 when penalties overwhelm positive points', () => {
    const score = computeExtractionScore({
      textLength: 50,
      sentenceCount: 1,
      linkDensity: 0.9,
      boilerplateHits: 999,
      hasTitle: false,
      hasByline: false,
      hasExcerpt: false,
      hasDate: false,
      readabilitySucceeded: false,
    });

    expect(score).toBe(0);
  });

  it('never exceeds 100 even with maximum positive contributions', () => {
    const score = computeExtractionScore({
      textLength: 20000,
      sentenceCount: 100,
      linkDensity: 0,
      boilerplateHits: -10,
      hasTitle: true,
      hasByline: true,
      hasExcerpt: true,
      hasDate: true,
      readabilitySucceeded: true,
    });

    expect(score).toBe(100);
  });

  it('handles zero or negative sentence counts by awarding zero sentence density points', () => {
    const baseParams = {
      textLength: 1000,
      linkDensity: 0,
      boilerplateHits: 0,
      hasTitle: false,
      hasByline: false,
      hasExcerpt: false,
      hasDate: false,
      readabilitySucceeded: false,
    };

    const zeroSentenceScore = computeExtractionScore({ ...baseParams, sentenceCount: 0 });
    const negativeSentenceScore = computeExtractionScore({ ...baseParams, sentenceCount: -2 });

    expect(zeroSentenceScore).toBe(20);
    expect(negativeSentenceScore).toBe(20);
  });
});

describe('getScoreLabel', () => {
  it('maps exact threshold boundaries to expected labels', () => {
    expect(getScoreLabel(85)).toBe('excellent');
    expect(getScoreLabel(84)).toBe('good');
    expect(getScoreLabel(70)).toBe('good');
    expect(getScoreLabel(69)).toBe('fair');
    expect(getScoreLabel(50)).toBe('fair');
    expect(getScoreLabel(49)).toBe('poor');
    expect(getScoreLabel(30)).toBe('poor');
    expect(getScoreLabel(29)).toBe('failed');
    expect(getScoreLabel(0)).toBe('failed');
  });
});

describe('isWeakExtraction', () => {
  it('returns true when score is below 45', () => {
    expect(isWeakExtraction(44, 1000, 0.1)).toBe(true);
  });

  it('returns true when text length is below 120', () => {
    expect(isWeakExtraction(90, 119, 0.05)).toBe(true);
  });

  it('returns true for short text with high link density combo', () => {
    expect(isWeakExtraction(80, 250, 0.36)).toBe(true);
  });

  it('returns false for healthy score, length, and link density', () => {
    expect(isWeakExtraction(80, 500, 0.2)).toBe(false);
  });
});
