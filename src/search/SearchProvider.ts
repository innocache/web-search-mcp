import type { SearchInput, SearchResult } from './models.js';

export interface SearchProvider {
  name: string;
  search(input: SearchInput): Promise<SearchResult[]>;
  isAvailable(): Promise<boolean>;
}
