/** Defaults from the Figma "Settings · Policies" screen. Stored in policy_settings; these are the fallbacks. */
export interface Policy {
  /** Calendar days from case closure until the cleanup is due. */
  slaDays: number;
  /** Hours after case closure at which reminders are sent. */
  reminderHours: number[];
  /** How many managers up the reporting line are told while an item stays overdue. 0 turns escalation off. */
  escalationLevels: number;
  /** Hours between one escalation level and the next. Level 1 is told at breach. */
  escalationStepHours: number;
  /** Master switch. Off means nothing is sent to Slack: no new items, reminders, escalations or edits. */
  slackEnabled: boolean;
  /** Set when Slack is paused, so messages that went stale in the meantime can be refreshed on resume. */
  slackPausedAt: string | null;
  /** Set when Slack is turned back on. Escalation steps count from here if it is later than the due date. */
  slackResumedAt: string | null;
}

export const DEFAULT_POLICY: Policy = {
  slaDays: 3,
  reminderHours: [24, 48],
  escalationLevels: 2,
  escalationStepHours: 24,
  slackEnabled: true,
  slackPausedAt: null,
  slackResumedAt: null,
};

export const MAX_ESCALATION_LEVELS = 5;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const dueAtFor = (caseClosedAt: Date, p: Policy = DEFAULT_POLICY): Date =>
  new Date(caseClosedAt.getTime() + p.slaDays * DAY);

export type SlaAction =
  | { kind: 'reminder'; hours: number }
  | { kind: 'escalate'; level: number };

export interface SlaFacts {
  caseClosedAt: Date;
  dueAt: Date;
  /** Reminder hour marks already sent (e.g. [24]). */
  remindersSent: number[];
  /** Escalation levels already told (1 = direct manager, 2 = their manager, ...). */
  escalationsSent: number[];
  /** When the last escalation actually went out, or null. */
  lastEscalatedAt: Date | null;
}

/**
 * When `level` is due: level 1 at breach, then one step later per level. If Slack was paused past the due date, the
 * clock restarts when it came back, with one step of grace so the engineer sees their message before anyone is told.
 */
export function escalationDueAt(dueAt: Date, level: number, p: Policy = DEFAULT_POLICY): Date {
  const stepMs = p.escalationStepHours * HOUR;
  const resumed = p.slackResumedAt ? new Date(p.slackResumedAt).getTime() : 0;
  const start = resumed > dueAt.getTime() ? resumed + stepMs : dueAt.getTime();
  return new Date(start + (level - 1) * stepMs);
}

/** Pure: which SLA actions are due right now? Idempotent given the facts. */
export function dueSlaActions(f: SlaFacts, now: Date, p: Policy = DEFAULT_POLICY): SlaAction[] {
  const out: SlaAction[] = [];
  // Only remind while not yet breached, and only for the latest mark that has passed: after a pause, catching up
  // must not send two reminders at once.
  if (now < f.dueAt) {
    const sinceClosure = (now.getTime() - f.caseClosedAt.getTime()) / HOUR;
    const mark = p.reminderHours.filter((h) => sinceClosure >= h).sort((a, b) => b - a)[0];
    if (mark !== undefined && !f.remindersSent.includes(mark)) out.push({ kind: 'reminder', hours: mark });
  }
  // One level at a time, each at least a step after the last one actually went out. A late tick (an outage, or the
  // policy gaining levels on an item already long overdue) therefore walks up the chain instead of telling everyone at once.
  const next = Array.from({ length: p.escalationLevels }, (_, i) => i + 1).find((l) => !f.escalationsSent.includes(l));
  if (next !== undefined && now >= escalationDueAt(f.dueAt, next, p)) {
    const spaced = !f.lastEscalatedAt || now.getTime() - f.lastEscalatedAt.getTime() >= p.escalationStepHours * HOUR;
    if (spaced) out.push({ kind: 'escalate', level: next });
  }
  return out;
}
