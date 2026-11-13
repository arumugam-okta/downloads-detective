/** Defaults from the Figma "Settings · Policies" screen. Stored in policy_settings; these are the fallbacks. */
export interface Policy {
  /** Calendar days from case closure until the cleanup is due. */
  slaDays: number;
  /** Hours after case closure at which reminders are sent. */
  reminderHours: number[];
  /** Hours after breach at which the director is also notified. */
  directorAfterBreachHours: number;
}

export const DEFAULT_POLICY: Policy = {
  slaDays: 3,
  reminderHours: [24, 48],
  directorAfterBreachHours: 24,
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const dueAtFor = (caseClosedAt: Date, p: Policy = DEFAULT_POLICY): Date =>
  new Date(caseClosedAt.getTime() + p.slaDays * DAY);

export type SlaAction =
  | { kind: 'reminder'; hours: number }
  | { kind: 'breach_manager' }
  | { kind: 'breach_director' };

export interface SlaFacts {
  caseClosedAt: Date;
  dueAt: Date;
  /** Reminder hour marks already sent (e.g. [24]). */
  remindersSent: number[];
  breachNotified: boolean;
  directorNotified: boolean;
}

/** Pure: which SLA actions are due right now? Idempotent given the facts. */
export function dueSlaActions(f: SlaFacts, now: Date, p: Policy = DEFAULT_POLICY): SlaAction[] {
  const out: SlaAction[] = [];
  const sinceClosure = (now.getTime() - f.caseClosedAt.getTime()) / HOUR;
  for (const h of p.reminderHours) {
    // Only remind while not yet breached; the breach message supersedes a late reminder.
    if (sinceClosure >= h && now < f.dueAt && !f.remindersSent.includes(h)) out.push({ kind: 'reminder', hours: h });
  }
  if (now >= f.dueAt && !f.breachNotified) out.push({ kind: 'breach_manager' });
  const sinceBreach = (now.getTime() - f.dueAt.getTime()) / HOUR;
  if (sinceBreach >= p.directorAfterBreachHours && !f.directorNotified) out.push({ kind: 'breach_director' });
  return out;
}
