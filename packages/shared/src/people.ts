import type { Person } from './types.ts';

/** Fields a people CSV can carry. `key` is what the mapping is keyed by. */
export const PEOPLE_FIELDS = [
  { key: 'email', label: 'Email', required: true, hint: 'Identifies the person; used for sign-in and Slack lookup' },
  { key: 'name', label: 'Full name', required: false, hint: 'Defaults to a name derived from the email' },
  { key: 'title', label: 'Job title', required: false, hint: '' },
  { key: 'team', label: 'Team', required: false, hint: 'The unit they belong to or lead' },
  { key: 'managerEmail', label: 'Manager email', required: false, hint: 'Builds the reporting hierarchy' },
  { key: 'roles', label: 'Roles', required: false, hint: 'manager, compliance (separate with ; or ,)' },
  { key: 'slackUserId', label: 'Slack member ID', required: false, hint: 'Looked up by email when blank' },
  { key: 'active', label: 'Active', required: false, hint: 'true/false, yes/no, active/inactive' },
] as const;

export type PeopleField = (typeof PEOPLE_FIELDS)[number]['key'];
/** Field -> CSV header it is read from. */
export type PeopleMapping = Partial<Record<PeopleField, string>>;

export const SLACK_ID_RE = /^[UW][A-Z0-9]{2,}$/;

export interface PeopleCsvInspection {
  headers: string[];
  total: number;
  sample: Array<Record<string, string>>;
  suggested: PeopleMapping;
}

export interface PeopleIssue {
  rowNo: number;
  email: string;
  level: 'error' | 'warning';
  message: string;
}

export interface PeopleImportRowPreview {
  rowNo: number;
  email: string;
  name: string;
  action: 'create' | 'update' | 'unchanged';
  manager: string | null;
}

export interface PeopleImportResult {
  dryRun: boolean;
  total: number;
  created: number;
  updated: number;
  unchanged: number;
  managersLinked: number;
  issues: PeopleIssue[];
  /** Set when the import must not run (e.g. it would leave no compliance user). */
  blocking: string | null;
  rows: PeopleImportRowPreview[];
}

/** The editable subset of a person, as sent by the user-management form. */
export interface PersonInput {
  name?: string;
  email?: string;
  title?: string | null;
  team?: string | null;
  managerId?: number | null;
  slackUserId?: string | null;
  isManager?: boolean;
  isCompliance?: boolean;
  active?: boolean;
}

export type PersonRoleKey = 'engineer' | 'manager' | 'compliance';
export const personRoles = (p: Pick<Person, 'isManager' | 'isCompliance'>, reports: number): PersonRoleKey[] => [
  'engineer',
  ...(p.isManager || reports > 0 ? (['manager'] as const) : []),
  ...(p.isCompliance ? (['compliance'] as const) : []),
];
