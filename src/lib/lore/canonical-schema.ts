/** Canonical archive fields are retained without interpretation or repair. */
export interface CanonicalLoreRecord {
  id: string;
  date: string;
  title: string;
  comment: string;
  original?: string;
  url?: string;
  img?: string;
  tags?: string;
  [field: string]: unknown;
}

export interface MediaReference {
  kind: 'image' | 'video' | 'audio' | 'artifact' | 'screenshot' | 'contract-evidence' | 'historical-page';
  source: string;
  attribution?: string;
  rightsStatus?: 'unknown' | 'cleared' | 'restricted' | 'public-domain';
  offlineEligible: boolean;
}

