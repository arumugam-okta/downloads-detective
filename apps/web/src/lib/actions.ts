'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSession, ROLE_HOME } from './session';
import type { Role } from '@dd/shared';

export interface ActionResult {
  ok: boolean;
  error?: string;
  data?: unknown;
}

const SERVICE_URL = (process.env.SERVICE_URL ?? 'http://127.0.0.1:4000').replace(/\/$/, '');

/** Every mutation goes through the slack-service, the only writer of lifecycle state. */
async function call(method: string, path: string, body?: unknown): Promise<ActionResult> {
  const { viewer } = await getSession();
  try {
    const res = await fetch(`${SERVICE_URL}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-dd-actor': viewer.person.email,
        ...(process.env.INTERNAL_TOKEN ? { authorization: `Bearer ${process.env.INTERNAL_TOKEN}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) return { ok: false, error: json.error ?? `Request failed (${res.status})` };
    return { ok: true, data: json };
  } catch {
    return { ok: false, error: 'Could not reach the Slack service. Is it running?' };
  }
}

export async function acknowledgeItem(id: number): Promise<ActionResult> {
  return call('POST', `/items/${id}/acknowledge`);
}
export async function attestItem(id: number, kind: string, notes: string): Promise<ActionResult> {
  return call('POST', `/items/${id}/attest`, { kind, notes });
}
export async function remindItem(id: number): Promise<ActionResult> {
  return call('POST', `/items/${id}/remind`);
}
export async function escalateItem(id: number): Promise<ActionResult> {
  return call('POST', `/items/${id}/escalate`);
}
export async function reviewItem(id: number): Promise<ActionResult> {
  return call('POST', `/items/${id}/review`);
}
export async function reassignItem(id: number, personId: number): Promise<ActionResult> {
  return call('POST', `/items/${id}/reassign`, { personId });
}
export async function retryItem(id: number): Promise<ActionResult> {
  return call('POST', `/items/${id}/retry`);
}
export async function retryAllFailed(): Promise<ActionResult> {
  return call('POST', '/imports/retry-failed');
}
export async function mapSlackUser(personId: number, slackUserId?: string): Promise<ActionResult> {
  return call('POST', `/people/${personId}/slack-map`, slackUserId ? { slackUserId } : {});
}
export async function savePolicy(p: { slaDays: number; reminderHours: number[]; directorAfterBreachHours: number }): Promise<ActionResult> {
  return call('PUT', '/policy', p);
}

export async function uploadReport(formData: FormData): Promise<ActionResult> {
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'Choose a CSV file' };
  const { viewer } = await getSession();
  if (!viewer.person.isCompliance) return { ok: false, error: 'Compliance access required' };
  try {
    const res = await fetch(`${SERVICE_URL}/reports?filename=${encodeURIComponent(file.name)}&source=web-upload`, {
      method: 'POST',
      headers: { 'content-type': 'text/csv', ...(process.env.INTERNAL_TOKEN ? { authorization: `Bearer ${process.env.INTERNAL_TOKEN}` } : {}) },
      body: await file.text(),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    return res.ok ? { ok: true, data: json } : { ok: false, error: json.error ?? `Upload failed (${res.status})` };
  } catch {
    return { ok: false, error: 'Could not reach the Slack service. Is it running?' };
  }
}

/** Dev only: preview the app as someone else. Production identity comes from the gateway header. */
export async function switchUser(email: string): Promise<void> {
  if (process.env.NODE_ENV === 'production' || process.env.DEV_AUTH === 'off') return;
  const c = await cookies();
  c.set('dd_user', email, { path: '/' });
  c.delete('dd_role');
  redirect('/');
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

/** What the Slack service is actually running with. null when it can't be reached. */
export async function getSlackStatus(): Promise<SlackStatus | null> {
  const r = await call('GET', '/slack/status');
  return r.ok ? (r.data as SlackStatus) : null;
}

export async function sendTestMessage(email?: string): Promise<ActionResult> {
  return call('POST', '/slack/test', email ? { email } : {});
}
