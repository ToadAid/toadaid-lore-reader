/**
 * An archive marker orders the Reader; it is not asserted publication time.
 * Equal markers sort by immutable canonical identity.
 */
export interface ReaderChronology {
  archiveChronologyMarker: string;
  sortKey: string;
  hasVerifiedPublicationTimestamp: false;
}

export function chronologyFor(canonicalId: string, marker: string): ReaderChronology {
  return {
    archiveChronologyMarker: marker,
    sortKey: `${marker}\u0000${canonicalId}`,
    hasVerifiedPublicationTimestamp: false,
  };
}

