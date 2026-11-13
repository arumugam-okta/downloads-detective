import { createHash } from 'node:crypto';

export interface FingerprintInput {
  downloadedBy: string;
  caseNumber: string;
  filename: string;
  downloadedOn: string;
}

/** Identity of one report row. Re-sent or overlapping reports produce the same fingerprint and are skipped. */
export const fingerprintOf = (r: FingerprintInput): string =>
  createHash('sha256')
    .update([r.downloadedBy, r.caseNumber, r.filename, r.downloadedOn].join('|').toLowerCase())
    .digest('hex');
