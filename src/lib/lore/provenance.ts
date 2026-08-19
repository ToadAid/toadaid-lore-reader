export const CANONICAL_REPOSITORY = 'ToadAid/toadaid.github.io';
export const CANONICAL_PATH = 'lore/data.json';
export const CANONICAL_COMMIT = '464933cecb6f508a980a66d37c8a7ef7add2f53d';

export interface LoreSourceProvenance {
  schemaVersion: '1.0.0';
  repository: typeof CANONICAL_REPOSITORY;
  path: typeof CANONICAL_PATH;
  commit: typeof CANONICAL_COMMIT;
  sourceDigest: `sha256:${string}`;
  recordCount: number;
  generatedAt: string;
}
