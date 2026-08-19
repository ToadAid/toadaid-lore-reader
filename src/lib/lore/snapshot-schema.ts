import type { CanonicalLoreRecord } from './canonical-schema';
import type { ReaderChronology } from './chronology';
import type { LoreSourceProvenance } from './provenance';

export interface ReaderSnapshotRecord {
  canonicalId: string;
  canonical: CanonicalLoreRecord;
  chronology: ReaderChronology;
}

export interface ReaderSnapshot {
  schemaVersion: '1.0.0';
  provenance: LoreSourceProvenance;
  records: ReaderSnapshotRecord[];
}

