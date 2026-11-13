import { parse } from 'csv-parse/sync';

export interface ReportRow {
  rowNo: number;
  caseNumber: string;
  downloadedBy: string;
  /** ISO-8601 */
  downloadedOn: string;
  filename: string;
  /** ISO-8601, when the report carries it. Otherwise the earliest download stands in. */
  caseClosedOn: string | null;
  caseSubject: string | null;
  downloadedByName: string | null;
}

export interface InvalidRow {
  rowNo: number;
  downloadedBy: string;
  reason: string;
}

const ALIASES: Record<string, string> = {
  case: 'case_number', case_no: 'case_number', case_id: 'case_number', casenumber: 'case_number',
  user: 'downloaded_by', downloadedby: 'downloaded_by', downloaded_by_email: 'downloaded_by', email: 'downloaded_by',
  downloaded_at: 'downloaded_on', downloadedon: 'downloaded_on', download_date: 'downloaded_on', date: 'downloaded_on',
  file_name: 'filename', file: 'filename', name: 'filename',
  closed_on: 'case_closed_on', case_closed: 'case_closed_on', case_closed_at: 'case_closed_on', closed_at: 'case_closed_on',
  subject: 'case_subject',
  downloaded_by_name: 'downloaded_by_name', user_name: 'downloaded_by_name',
};
const REQUIRED = ['case_number', 'downloaded_by', 'downloaded_on', 'filename'] as const;

const normHeader = (h: string): string => {
  const k = h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return ALIASES[k] ?? k;
};

const toIso = (v: string | undefined): string | null => {
  if (!v) return null;
  const t = Date.parse(v.trim());
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

export class ReportFormatError extends Error {}

export function parseReport(csv: string): { rows: ReportRow[]; invalid: InvalidRow[] } {
  let records: Record<string, string>[];
  try {
    records = parse(csv, {
      columns: (h: string[]) => h.map(normHeader),
      skip_empty_lines: true,
      trim: true,
      bom: true,
      relax_column_count: true,
    });
  } catch (e) {
    throw new ReportFormatError(`Could not read CSV: ${(e as Error).message}`);
  }
  if (records.length === 0) throw new ReportFormatError('Report has no rows');
  const missing = REQUIRED.filter((c) => !(c in records[0]!));
  if (missing.length) throw new ReportFormatError(`Report missing required column(s): ${missing.join(', ')}`);

  const rows: ReportRow[] = [];
  const invalid: InvalidRow[] = [];
  records.forEach((r, i) => {
    const rowNo = i + 2; // header is row 1
    const by = (r.downloaded_by ?? '').trim().toLowerCase();
    const caseNumber = (r.case_number ?? '').trim().replace(/^#/, '');
    const filename = (r.filename ?? '').trim();
    const downloadedOn = toIso(r.downloaded_on);
    const reason = !by.includes('@') ? 'Downloaded by is not an email address'
      : !caseNumber ? 'Missing case number'
        : !filename ? 'Missing filename'
          : !downloadedOn ? 'Downloaded on is not a valid date'
            : null;
    if (reason) return void invalid.push({ rowNo, downloadedBy: by || '(blank)', reason });
    rows.push({
      rowNo, caseNumber, downloadedBy: by, downloadedOn: downloadedOn!, filename,
      caseClosedOn: toIso(r.case_closed_on), caseSubject: r.case_subject?.trim() || null, downloadedByName: r.downloaded_by_name?.trim() || null,
    });
  });
  return { rows, invalid };
}

/** "maya.patel@acme.io" -> "Maya Patel" (only used when the report gives no name). */
export function nameFromEmail(email: string): string {
  return (email.split('@')[0] ?? email)
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p[0]!.toUpperCase() + p.slice(1))
    .join(' ');
}
