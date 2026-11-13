import type { Person } from '@dd/shared';

import { fingerprintOf } from '@dd/db';
import { HttpError } from './errors.ts';
import { requireCompliance } from './authz.ts';
import type { Lifecycle } from './lifecycle.ts';
import { ConsoleNotifier } from './notifier.ts';

export interface TestResult {
  ok: boolean;
  itemId: number;
  ref: string;
  delivered: boolean;
  /** Where it went: 'slack' for a real DM, 'dev-outbox' when no bot token is set. */
  channel: 'slack' | 'dev-outbox';
  message: string;
}

/**
 * Creates a clearly-labelled test item for `email` and delivers it exactly like a real report would, so the
 * Acknowledge / Confirm buttons and the confirmation form can be exercised. A fresh case number each time
 * means repeated tests never collide with the "one item per engineer + case" rule.
 */
export async function sendTest(l: Lifecycle, by: Person, email: string): Promise<TestResult> {
  requireCompliance(by);
  const { store } = l;
  const now = l.now();
  const stamp = now.toISOString().replace(/[-:T.Z]/g, '').slice(2, 14);
  const caseNumber = `TEST-${stamp}`;
  const engineer = await store.upsertPersonByEmail({ email, name: email.split('@')[0]!.replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) });
  const policy = await store.getPolicy();

  const item = await store.createItem({
    engineerId: engineer.id, caseNumber, caseSubject: 'Slack test message (safe to ignore)', caseClosedAt: now.toISOString(),
    dueAt: new Date(now.getTime() + policy.slaDays * 86_400_000).toISOString(), state: 'open', createdImportId: null,
  });
  const files = ['test_export.csv', 'test_debug.log'].map((filename) => {
    const downloadedOn = now.toISOString();
    return { fingerprint: fingerprintOf({ downloadedBy: email, caseNumber, filename, downloadedOn }), itemId: item.id, filename, downloadedOn };
  });
  await store.addFiles(files);
  await l.audit({ actorId: by.id, actorLabel: by.name, itemId: item.id, action: 'test_message', detail: `Sent a test message to ${email}` });

  const result = await l.deliver(item.id);
  const fresh = await l.mustItem(item.id);
  const live = !(l.deps.notifier instanceof ConsoleNotifier);
  if (result === 'delivered') {
    return {
      ok: true, itemId: item.id, ref: item.ref, delivered: true, channel: live ? 'slack' : 'dev-outbox',
      message: live ? `Sent to ${email} in Slack. Open the DM and try the buttons.` : 'Dev mode: no Slack token, so the message was logged to /dev/outbox instead of sent.',
    };
  }
  if (result === 'triage') {
    throw new HttpError(409, `Slack has no user with the email ${email}. Check the email on that person's Slack profile (and that the app has the users:read.email scope).`);
  }
  throw new HttpError(502, `Slack delivery failed: ${fresh.error ?? 'unknown error'}`);
}


export interface SlackStatus {
  mode: 'live' | 'dev';
  botToken: boolean;
  /** True when Socket Mode is configured, so the buttons in Slack work. */
  interactive: boolean;
  webUrl: string;
}

export function slackStatus(l: Lifecycle, by: Person, cfg: { slack: { botToken?: string | undefined; appToken?: string | undefined }; webUrl: string }): SlackStatus {
  requireCompliance(by);
  return {
    mode: l.deps.notifier instanceof ConsoleNotifier ? 'dev' : 'live', botToken: !!cfg.slack.botToken, interactive: !!cfg.slack.appToken, webUrl: cfg.webUrl,
  };
}
