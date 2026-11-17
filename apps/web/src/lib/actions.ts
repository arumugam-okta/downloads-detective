'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getBackend } from './backend';
import { getSession, ROLE_HOME } from './session';
import type { PeopleCsvInspection, PeopleImportResult, PeopleMapping, PersonInput, Role, SlackSyncResult } from '@dd/shared';

export interface ActionResult {
  ok: boolean;
  error?: string;
  data?: unknown;
}

async function actor() {
  return (await getSession()).viewer.person;
}

export async function acknowledgeItem(id: number): Promise<ActionResult> {
  return getBackend().acknowledge(await actor(), id);
}
export async function attestItem(id: number, kind: string, notes: string): Promise<ActionResult> {
  return getBackend().attest(await actor(), id, kind, notes);
}
export async function remindItem(id: number): Promise<ActionResult> {
  return getBackend().remind(await actor(), id);
}
export async function escalateItem(id: number): Promise<ActionResult> {
  return getBackend().escalate(await actor(), id);
}
export async function reviewItem(id: number): Promise<ActionResult> {
  return getBackend().review(await actor(), id);
}
export async function reassignItem(id: number, personId: number): Promise<ActionResult> {
  return getBackend().reassign(await actor(), id, personId);
}
export async function retryItem(id: number): Promise<ActionResult> {
  return getBackend().retry(await actor(), id);
}
export async function retryAllFailed(): Promise<ActionResult> {
  return getBackend().retryAllFailed(await actor());
}
export async function mapSlackUser(personId: number, slackUserId?: string): Promise<ActionResult> {
  return getBackend().mapSlackUser(await actor(), personId, slackUserId);
}
export async function savePolicy(p: { slaDays: number; reminderHours: number[]; directorAfterBreachHours: number }): Promise<ActionResult> {
  return getBackend().savePolicy(await actor(), p);
}

export async function uploadReport(formData: FormData): Promise<ActionResult> {
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'Choose a CSV file' };
  return getBackend().uploadReport(await actor(), await file.text(), file.name);
}

export async function switchRole(role: Role): Promise<void> {
  const { viewer } = await getSession();
  if (!viewer.roles.includes(role)) return;
  (await cookies()).set('dd_role', role, { path: '/' });
  redirect(ROLE_HOME[role]);
}

export interface SlackStatus {
  mode: 'live' | 'dev';
  botToken: boolean;
  interactive: boolean;
  webUrl: string;
}

/** What the Slack backend is actually running with. null when it can't be reached. */
export async function getSlackStatus(): Promise<SlackStatus | null> {
  const r = await getBackend().slackStatus(await actor());
  return r.ok ? (r.data as SlackStatus) : null;
}

export async function sendTestMessage(email?: string): Promise<ActionResult> {
  return getBackend().sendTest(await actor(), email);
}

// ---- user management

export async function inspectPeopleFile(formData: FormData): Promise<ActionResult & { data?: PeopleCsvInspection }> {
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'Choose a CSV file' };
  return getBackend().inspectPeople(await actor(), await file.text()) as Promise<ActionResult & { data?: PeopleCsvInspection }>;
}
export async function importPeople(formData: FormData, mapping: PeopleMapping, dryRun: boolean): Promise<ActionResult & { data?: PeopleImportResult }> {
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'Choose a CSV file' };
  return getBackend().importPeople(await actor(), await file.text(), mapping, dryRun, file.name) as Promise<ActionResult & { data?: PeopleImportResult }>;
}
export async function createPerson(input: PersonInput): Promise<ActionResult> {
  return getBackend().createPerson(await actor(), input);
}
export async function updatePerson(id: number, input: PersonInput): Promise<ActionResult> {
  return getBackend().updatePerson(await actor(), id, input);
}
export async function syncSlack(dryRun: boolean, createMissing: boolean): Promise<ActionResult & { data?: SlackSyncResult }> {
  return getBackend().syncSlack(await actor(), dryRun, createMissing) as Promise<ActionResult & { data?: SlackSyncResult }>;
}
