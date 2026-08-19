export const CANONICAL_REPOSITORY = 'ToadAid/toadaid.github.io';
export const CANONICAL_PATH = 'lore/data.json';
export const CANONICAL_COMMIT = '041c2ea6fda8284f61fb35c7101d083623d235ba';

export interface LoreSourceProvenance {
  schemaVersion: '1.0.0';
  repository: typeof CANONICAL_REPOSITORY;
  path: typeof CANONICAL_PATH;
  commit: typeof CANONICAL_COMMIT;
  sourceDigest: `sha256:${string}`;
  recordCount: number;
  generatedAt: string;
}

