import type { GeneratedArchiveRecord } from './archive-cover-state';
import { publicPath } from '../public-site.ts';

export function orderedRecords(records: GeneratedArchiveRecord[]): GeneratedArchiveRecord[] {
  return [...records].sort((left, right) => left.chronology.sortKey.localeCompare(right.chronology.sortKey));
}

export function recordRoute(canonicalId: string, base = '/'): string {
  return publicPath(`/record/${encodeURIComponent(canonicalId)}/`, base);
}

export function yearFor(record: GeneratedArchiveRecord): string {
  return record.chronology.archiveChronologyMarker.slice(0, 4);
}
