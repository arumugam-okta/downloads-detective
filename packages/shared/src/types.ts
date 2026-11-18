import type { AttestationKind, ItemState } from './state.ts';

/** All timestamps are ISO-8601 strings so the same shapes cross JSON boundaries unchanged. */
export interface Person {
  id: number;
  email: string;
  name: string;
  title: string | null;
  /** The unit this person leads (managers) or belongs to (engineers). */
  team: string | null;
  managerId: number | null;
  slackUserId: string | null;
  isCompliance: boolean;
  /** Explicitly granted manager role. People who lead someone are managers regardless of this flag. */
  isManager: boolean;
  active: boolean;
  /** Profile data pulled from Slack. Null until a sync has run. */
  department: string | null;
  division: string | null;
  organization: string | null;
  costCenter: string | null;
  employeeNumber: string | null;
  employeeType: string | null;
  location: string | null;
  timezone: string | null;
  /** Where managerId came from: a Slack sync overwrites 'slack' links only, never 'manual' ones. */
  managerSource: 'slack' | 'manual' | null;
  slackSyncedAt: string | null;
}

export interface Item {
  id: number;
  ref: string;
  engineerId: number;
  caseNumber: string;
  caseSubject: string | null;
  caseClosedAt: string;
  dueAt: string;
  state: ItemState;
  error: string | null;
  createdImportId: number | null;
  createdAt: string;
  acknowledgedAt: string | null;
  remindersSent: number[];
  /** Escalation levels already told: 1 = direct manager, 2 = their manager, and so on. */
  escalationsSent: number[];
  /** When the most recent escalation went out. Spaces levels apart even when a tick runs late. */
  escalatedAt: string | null;
  attestationKind: AttestationKind | null;
  attestationNotes: string | null;
  attestedAt: string | null;
  reviewedBy: number | null;
  reviewedAt: string | null;
  slackChannel: string | null;
  slackTs: string | null;
}

export interface ItemFile {
  fingerprint: string;
  itemId: number;
  filename: string;
  downloadedOn: string;
}

export interface ReportImport {
  id: number;
  filename: string;
  source: string;
  receivedAt: string;
  rowsTotal: number;
  duplicateRows: number;
  itemsCreated: number;
  itemsUpdated: number;
  failures: number;
}

export type IssueKind = 'triage' | 'failed';

export interface ImportIssue {
  id: number;
  importId: number;
  itemId: number | null;
  rowNo: number | null;
  downloadedBy: string;
  issue: string;
  kind: IssueKind;
  createdAt: string;
  resolvedAt: string | null;
}

export interface AuditEvent {
  id: number;
  at: string;
  actorId: number | null;
  /** 'Downloads Detective' for system actions. */
  actorLabel: string;
  action: string;
  itemId: number | null;
  importId: number | null;
  detail: string | null;
}

export const SYSTEM_ACTOR = 'Downloads Detective';
