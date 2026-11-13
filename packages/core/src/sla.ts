import { SYSTEM_ACTOR, dueSlaActions, escalationTargets, isOpenState, type Item } from '@dd/shared';
import { escalationMessage, reminderMessage } from './blocks.ts';
import type { Lifecycle } from './lifecycle.ts';

const SYSTEM = { actorId: null, actorLabel: SYSTEM_ACTOR } as const;

export interface TickResult {
  reminders: number;
  managerNotified: number;
  directorNotified: number;
}

/**
 * One pass over every open item. Idempotent: what has been sent is recorded on the item, so running it
 * twice (or from both the in-process timer and an external cron) never double-notifies.
 */
export async function runSlaTick(l: Lifecycle): Promise<TickResult> {
  const { store, deps } = l;
  const now = l.now();
  const policy = await store.getPolicy();
  const people = await store.listPeople();
  const result: TickResult = { reminders: 0, managerNotified: 0, directorNotified: 0 };

  const items = await store.listItems({ states: ['open', 'acknowledged'] });
  for (const item of items) {
    // Undelivered items (triage/failed) are excluded above: there is nobody to remind yet.
    if (!isOpenState(item.state) || !item.slackChannel) continue;
    try {
      const actions = dueSlaActions({
        caseClosedAt: new Date(item.caseClosedAt), dueAt: new Date(item.dueAt), remindersSent: item.remindersSent,
        breachNotified: item.breachNotifiedAt !== null, directorNotified: item.directorNotifiedAt !== null,
      }, now, policy);

      for (const a of actions) {
        if (a.kind === 'reminder') await remind(l, item, a.hours, result);
        else await escalate(l, item, a.kind === 'breach_director' ? 'director' : 'manager', people, result);
      }
    } catch (e) {
      console.error(`[sla] item ${item.ref} failed: ${(e as Error).message}`);
    }
  }
  void deps;
  return result;
}

async function remind(l: Lifecycle, item: Item, hours: number, result: TickResult): Promise<void> {
  // Record first: a Slack failure must not turn into a reminder on every tick.
  await l.store.updateItem(item.id, { remindersSent: [...item.remindersSent, hours] });
  item.remindersSent = [...item.remindersSent, hours];
  await l.deps.notifier.sendInDm(item.slackChannel!, reminderMessage(item, l.ctx()));
  const engineer = await l.mustPerson(item.engineerId);
  await l.audit({ ...SYSTEM, itemId: item.id, action: 'reminder_sent', detail: `Sent ${hours}h reminder to ${engineer.name}` });
  result.reminders++;
}

async function escalate(l: Lifecycle, item: Item, level: 'manager' | 'director', people: Awaited<ReturnType<Lifecycle['store']['listPeople']>>, result: TickResult): Promise<void> {
  const engineer = await l.mustPerson(item.engineerId);
  const targets = escalationTargets(people, engineer.id);
  const target = level === 'manager' ? targets.manager : targets.director;
  const at = l.now().toISOString();
  item = await l.store.updateItem(item.id, level === 'manager' ? { breachNotifiedAt: at } : { directorNotifiedAt: at });

  const msg = escalationMessage(item, engineer, level, l.ctx());
  const delivered = target ? await l.dmPerson(target, msg).catch(() => false) : false;
  await l.audit({
    ...SYSTEM, itemId: item.id, action: level === 'manager' ? 'manager_notified' : 'director_notified',
    detail: !target ? `No ${level} on record, so nobody was notified`
      : delivered ? `Notified ${level} ${target.name}: SLA ${level === 'manager' ? 'missed' : 'still missed'}`
        : `Could not notify ${level} ${target.name}: no Slack account`,
  });
  if (level === 'manager') result.managerNotified++; else result.directorNotified++;
}
