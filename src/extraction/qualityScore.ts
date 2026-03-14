export interface ExtractionScoreParams {
  textLength: number;
  sentenceCount: number;
  linkDensity: number;
  boilerplateHits: number;
  hasTitle: boolean;
  hasByline: boolean;
  hasExcerpt: boolean;
  hasDate: boolean;
  readabilitySucceeded: boolean;
}

function lengthPoints(textLength: number): number {
  if (textLength >= 5000) return 40;
  if (textLength >= 2000) return 30;
  if (textLength >= 1000) return 20;
  if (textLength >= 300) return 10;
  if (textLength >= 50) return 5;
  return 0;
}

function sentenceDensityPoints(textLength: number, sentenceCount: number): number {
  if (sentenceCount <= 0) return 0;
  const avg = textLength / sentenceCount;
  if (avg >= 40 && avg <= 200) return 25;
  if (avg >= 20 && avg <= 300) return 12;
  return 0;
}

function linkDensityPenalty(linkDensity: number): number {
  if (linkDensity > 0.5) return -20;
  if (linkDensity > 0.3) return -10;
  if (linkDensity > 0.15) return -5;
  return 0;
}

function boilerplatePenalty(boilerplateHits: number): number {
  const penalty = Math.max(0, boilerplateHits) * -3;
  return Math.max(-15, penalty);
}

function metadataPoints(params: ExtractionScoreParams): number {
  let score = 0;
  if (params.hasTitle) score += 7;
  if (params.hasByline) score += 4;
  if (params.hasExcerpt) score += 4;
  if (params.hasDate) score += 5;
  return score;
}

export function computeExtractionScore(params: ExtractionScoreParams): number {
  const rawScore =
    lengthPoints(params.textLength) +
    sentenceDensityPoints(params.textLength, params.sentenceCount) +
    linkDensityPenalty(params.linkDensity) +
    boilerplatePenalty(params.boilerplateHits) +
    metadataPoints(params) +
    (params.readabilitySucceeded ? 15 : 0);

  return Math.min(100, Math.max(0, rawScore));
}

export function getScoreLabel(score: number): string {
  if (score >= 85) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 50) return 'fair';
  if (score >= 30) return 'poor';
  return 'failed';
}

export function isWeakExtraction(score: number, textLength: number, linkDensity: number): boolean {
  if (score < 45) return true;
  if (textLength < 300 && linkDensity > 0.35) return true;
  if (textLength < 120) return true;
  return false;
}
