import type { GeneratedArchiveRecord } from './archive-cover-state';

export function orderedRecords(records: GeneratedArchiveRecord[]): GeneratedArchiveRecord[] {
  return [...records].sort((left, right) => left.chronology.sortKey.localeCompare(right.chronology.sortKey));
}

export function recordRoute(canonicalId: string): string {
  return `/record/${encodeURIComponent(canonicalId)}/`;
}

export function yearFor(record: GeneratedArchiveRecord): string {
  return record.chronology.archiveChronologyMarker.slice(0, 4);
}
