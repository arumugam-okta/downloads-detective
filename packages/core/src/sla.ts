import { SYSTEM_ACTOR, dueSlaActions, escalationChain, escalationDueAt, escalationRole, isOpenState, type Item, type Policy } from '@dd/shared';
import { escalationMessage, reminderMessage } from './blocks.ts';
import type { Lifecycle } from './lifecycle.ts';

const SYSTEM = { actorId: null, actorLabel: SYSTEM_ACTOR } as const;

export interface TickResult {
  reminders: number;
  escalations: number;
  /** True when Slack messaging is switched off, so the tick did nothing. */
  paused: boolean;
}

/**
 * One pass over every open item. Idempotent: what has been sent is recorded on the item, so running it
 * twice (or from both the in-process timer and an external cron) never double-notifies.
 * Does nothing while Slack messaging is paused: nothing is recorded as sent, so it all resumes cleanly.
 */
export async function runSlaTick(l: Lifecycle): Promise<TickResult> {
  const { store } = l;
  const now = l.now();
  const policy = await store.getPolicy();
  const result: TickResult = { reminders: 0, escalations: 0, paused: !policy.slackEnabled };
  if (!policy.slackEnabled) return result;
  const people = await store.listPeople();

  const items = await store.listItems({ states: ['open', 'acknowledged'] });
  for (const item of items) {
    // Undelivered items (triage/failed/held) are excluded: there is nobody to remind yet.
    if (!isOpenState(item.state) || !item.slackChannel) continue;
    try {
      const actions = dueSlaActions({
        caseClosedAt: new Date(item.caseClosedAt), dueAt: new Date(item.dueAt), remindersSent: item.remindersSent, escalationsSent: item.escalationsSent,
        lastEscalatedAt: item.escalatedAt ? new Date(item.escalatedAt) : null,
      }, now, policy);

      let current = item;
      for (const a of actions) {
        if (a.kind === 'reminder') await remind(l, current, a.hours, result);
        else current = await escalate(l, current, a.level, people, policy, result);
      }
    } catch (e) {
      console.error(`[sla] item ${item.ref} failed: ${(e as Error).message}`);
    }
  }
  return result;
}

async function remind(l: Lifecycle, item: Item, hours: number, result: TickResult): Promise<void> {
  // Record first: a Slack failure must not turn into a reminder on every tick.
  await l.store.updateItem(item.id, { remindersSent: [...item.remindersSent, hours] });
  item.remindersSent = [...item.remindersSent, hours];
  const files = await l.store.listFiles([item.id]);
  await l.deps.notifier.sendInDm(item.slackChannel!, reminderMessage(item, files.length, l.ctx()));
  const engineer = await l.mustPerson(item.engineerId);
  await l.audit({ ...SYSTEM, itemId: item.id, action: 'reminder_sent', detail: `Sent ${hours}h reminder to ${engineer.name}` });
  result.reminders++;
}

const AUDIT_ACTION = (level: number) => (level === 1 ? 'manager_notified' : level === 2 ? 'director_notified' : 'escalation_notified');

/** Tells the person `level` steps above the engineer. Returns the item with the level recorded. */
async function escalate(l: Lifecycle, item: Item, level: number, people: Awaited<ReturnType<Lifecycle['store']['listPeople']>>, policy: Policy, result: TickResult): Promise<Item> {
  const engineer = await l.mustPerson(item.engineerId);
  const chain = escalationChain(people, engineer.id);
  const target = chain[level - 1] ?? null;
  // Record first, as for reminders. A level with nobody to tell is recorded too, or it would be retried every tick.
  item = await l.store.updateItem(item.id, { escalationsSent: [...new Set([...item.escalationsSent, level])].sort((a, b) => a - b), escalatedAt: l.now().toISOString() });
  if (!target) {
    if (level === chain.length + 1) {
      await l.audit({ ...SYSTEM, itemId: item.id, action: AUDIT_ACTION(level), detail: `No ${escalationRole(level)} on record, so nobody was notified` });
    }
    return item;
  }

  const files = await l.store.listFiles([item.id]);
  const nextAt = level < policy.escalationLevels && chain[level] ? escalationDueAt(new Date(item.dueAt), level + 1, policy).toISOString() : null;
  const delivered = await l.dmPerson(target, escalationMessage(item, engineer, level, l.ctx(), { fileCount: files.length, nextAt })).catch(() => false);
  await l.audit({
    ...SYSTEM, itemId: item.id, action: AUDIT_ACTION(level),
    detail: delivered ? `Notified ${escalationRole(level)} ${target.name}: SLA ${level === 1 ? 'missed' : 'still missed'}`
      : `Could not notify ${escalationRole(level)} ${target.name}: no Slack account`,
  });
  result.escalations++;
  return item;
}
