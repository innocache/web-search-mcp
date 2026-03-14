export interface SearchInput {
  query: string;
  numResults: number;
  locale?: string;
  region?: string;
}

export interface SearchResult {
  rank: number;
  title: string;
  url: string;
  displayUrl?: string;
  snippet?: string;
  source?: string;
}

export interface RawSerpResult {
  title: string;
  url: string;
  displayUrl?: string;
  snippet?: string;
  isAd: boolean;
  position: number;
}
