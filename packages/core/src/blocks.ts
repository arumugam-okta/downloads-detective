// Slack Block Kit builders. Paste the `blocks` JSON into https://app.slack.com/block-kit-builder to preview.
import type { Button, KnownBlock, ModalView } from '@slack/types';
import { ATTESTATION_LABEL, ATTESTATION_KINDS, displayStatus, escalationRole, type Item, type ItemFile, type Person } from '@dd/shared';

export interface SlackMessage {
  text: string;
  blocks: KnownBlock[];
}

export const ACTION = { ACK: 'dd_ack', CONFIRM: 'dd_confirm', OPEN_WEB: 'dd_open_web', OPEN_TEAM: 'dd_open_team' } as const;
export const ATTEST_MODAL = 'dd_attest_modal';

/** Slack mrkdwn control characters. */
export const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const section = (text: string): KnownBlock => ({ type: 'section', text: { type: 'mrkdwn', text: text.slice(0, 2900) } });
/** The design's bold lead line. Slack headers cannot be coloured or sized, so a bold section is closest. */
const title = (text: string): KnownBlock => section(`*${text}*`);
const context = (text: string): KnownBlock => ({ type: 'context', elements: [{ type: 'mrkdwn', text }] });
const fields = (...pairs: Array<[label: string, value: string]>): KnownBlock => ({
  type: 'section',
  fields: pairs.map(([l, v]) => ({ type: 'mrkdwn' as const, text: `*${l}*\n${v}` })),
});

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const monthDay = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const hhmm = (d: Date) => d.toISOString().slice(11, 16);
/** "Nov 16, 2026 · 06:01 UTC". The designs show UTC, so every reader sees the same time. */
export const utcFull = (iso: string): string => { const d = new Date(iso); return `${monthDay.format(d)}, ${d.getUTCFullYear()} · ${hhmm(d)} UTC`; };
/** "Nov 16 at 06:01 UTC" */
export const utcAt = (iso: string): string => { const d = new Date(iso); return `${monthDay.format(d)} at ${hhmm(d)} UTC`; };

export interface MessageContext {
  webUrl: string;
  now: Date;
}

const itemUrl = (c: MessageContext, item: Item) => `${c.webUrl}/items/${item.id}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const firstName = (p: Person) => esc(p.name.split(/\s+/)[0] ?? p.name);
const caseRef = (item: Item) => `Case #${esc(item.caseNumber)}`;
const policyDays = (item: Item) => Math.max(1, Math.round((new Date(item.dueAt).getTime() - new Date(item.caseClosedAt).getTime()) / DAY));

const button = (action_id: string, text: string, extra: { value?: string; url?: string; primary?: boolean } = {}): Button => ({
  type: 'button', action_id, text: { type: 'plain_text', text },
  ...(extra.value ? { value: extra.value } : {}), ...(extra.url ? { url: extra.url } : {}), ...(extra.primary ? { style: 'primary' as const } : {}),
});

/** "24 hours remaining" / "2 days remaining", rounded the way the designs read. */
function remaining(item: Item, now: Date): string {
  const h = Math.max(1, Math.round((new Date(item.dueAt).getTime() - now.getTime()) / HOUR));
  return h < 48 ? `${plural(h, 'hour')} remaining` : `${plural(Math.round(h / 24), 'day')} remaining`;
}
const dueLine = (item: Item, now: Date) =>
  now >= new Date(item.dueAt) ? `:rotating_light: Overdue since ${utcAt(item.dueAt)}` : `:warning: Due ${utcAt(item.dueAt)} · ${remaining(item, now)}`;

const REASON = 'You\u2019re receiving this private reminder because you downloaded these files.';

/** What the engineer attested, in the confirmation's own words. */
function attestedSentence(item: Item, files: ItemFile[]): string {
  const n = files.length;
  switch (item.attestationKind) {
    case 'deleted': return `that ${n === 1 ? 'the local file was' : `all ${n} local files were`} deleted`;
    case 'approved_location': return `that ${n === 1 ? 'the local file is' : `all ${n} local files are`} in an approved location`;
    case 'not_applicable': return 'that cleanup does not apply';
    default: return 'for this cleanup';
  }
}

/**
 * The engineer's message. Re-rendered in place as the item moves through its lifecycle, so the same function
 * covers the first prompt (open), acknowledged, overdue, and the confirmation (closed).
 */
export function itemMessage(item: Item, files: ItemFile[], engineer: Person, c: MessageContext): SlackMessage {
  const status = displayStatus(item.state, new Date(item.dueAt), c.now);
  const n = files.length;

  if (status === 'closed') {
    const text = 'Cleanup confirmed';
    const blocks: KnownBlock[] = [
      section(':white_check_mark: *Cleanup confirmed*'),
      section(
        `Thanks, ${firstName(engineer)}. Your attestation ${attestedSentence(item, files)} is recorded for ${caseRef(item)}.` +
          (item.attestationNotes ? `\n>${esc(item.attestationNotes).replace(/\n/g, '\n>')}` : ''),
      ),
      context(`Recorded ${utcAt(item.attestedAt ?? c.now.toISOString())} \u00b7 Reminders stopped`),
      { type: 'actions', elements: [button(ACTION.OPEN_WEB, 'View record', { url: itemUrl(c, item) })] },
    ];
    return { text, blocks };
  }

  const overdue = status === 'overdue';
  const text = overdue ? `Overdue: cleanup for case #${item.caseNumber}` : `Action needed: cleanup for case #${item.caseNumber}`;
  const buttons: Button[] = [button(ACTION.CONFIRM, 'Review & confirm', { value: String(item.id), primary: true })];
  if (item.state === 'open') buttons.push(button(ACTION.ACK, 'Acknowledge', { value: String(item.id) }));
  else buttons.push(button(ACTION.OPEN_WEB, 'View cleanup item', { url: itemUrl(c, item) }));

  const foot = overdue ? 'Overdue \u00b7 Please confirm as soon as you can.'
    : item.state === 'acknowledged' ? 'Acknowledged \u00b7 You still need to confirm the cleanup.'
      : `${policyDays(item)}-calendar-day policy \u00b7 Acknowledging does not complete cleanup.`;
  const blocks: KnownBlock[] = [
    title(overdue ? 'This cleanup is overdue.' : 'A closed case needs a quick cleanup.'),
    section(
      `Hi ${firstName(engineer)} \u2014 ${caseRef(item)} is closed. Please delete the ${plural(n, 'local file')} you downloaded, or confirm an approved exception.` +
        (item.caseSubject ? `\n_${esc(item.caseSubject)}_` : ''),
    ),
    fields(['Case', caseRef(item)], [overdue ? 'Was due' : 'Cleanup due', utcFull(item.dueAt)]),
    { type: 'actions', elements: buttons },
    context(foot),
  ];
  return { text, blocks };
}

export function attestModal(item: Item): ModalView {
  return {
    type: 'modal',
    callback_id: ATTEST_MODAL,
    private_metadata: String(item.id),
    title: { type: 'plain_text', text: 'Confirm action taken' },
    submit: { type: 'plain_text', text: 'Submit' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      section(`Case *#${esc(item.caseNumber)}* · ${item.ref}`),
      {
        type: 'input',
        block_id: 'kind',
        label: { type: 'plain_text', text: 'What did you do?' },
        element: {
          type: 'radio_buttons',
          action_id: 'v',
          options: ATTESTATION_KINDS.map((k) => ({ text: { type: 'plain_text', text: ATTESTATION_LABEL[k] }, value: k })),
        },
      },
      {
        type: 'input',
        block_id: 'notes',
        optional: true,
        label: { type: 'plain_text', text: 'Where are the files, or why does this not apply?' },
        hint: { type: 'plain_text', text: 'Required unless you deleted the files.' },
        element: { type: 'plain_text_input', action_id: 'v', multiline: true, max_length: 2000 },
      },
    ],
  };
}

/** Scheduled reminder. "Due tomorrow" when under a day and a half is left, otherwise the remaining time. */
export function reminderMessage(item: Item, fileCount: number, c: MessageContext): SlackMessage {
  const left = new Date(item.dueAt).getTime() - c.now.getTime();
  const lead = left <= 0 ? 'Reminder: cleanup is overdue.' : left <= 36 * HOUR ? 'Reminder: cleanup is due tomorrow.' : `Reminder: cleanup is due in ${plural(Math.round(left / DAY), 'day')}.`;
  return {
    text: `Reminder: cleanup for case #${item.caseNumber} is still open`,
    blocks: [
      title(lead),
      section(`The ${plural(fileCount, 'file')} from ${caseRef(item)} still ${fileCount === 1 ? 'needs' : 'need'} your attention. After you delete ${fileCount === 1 ? 'it' : 'them'}, confirm the action here.`),
      section(dueLine(item, c.now)),
      { type: 'actions', elements: [button(ACTION.CONFIRM, 'Review & confirm', { value: String(item.id), primary: true }), button(ACTION.OPEN_WEB, 'View cleanup item', { url: itemUrl(c, item) })] },
      context(REASON),
    ],
  };
}

/** A manager nudging an engineer by hand. Same shape as the scheduled reminder, with who sent it. */
export function manualReminderMessage(item: Item, fileCount: number, by: Person, c: MessageContext): SlackMessage {
  return {
    text: `${by.name} sent a reminder for case #${item.caseNumber}`,
    blocks: [
      title('A reminder to finish your cleanup.'),
      section(`${esc(by.name)} asked you to finish the cleanup for ${caseRef(item)}. Please delete the ${plural(fileCount, 'local file')}, or confirm an approved exception.`),
      section(dueLine(item, c.now)),
      { type: 'actions', elements: [button(ACTION.CONFIRM, 'Review & confirm', { value: String(item.id), primary: true }), button(ACTION.OPEN_WEB, 'View cleanup item', { url: itemUrl(c, item) })] },
      context(REASON),
    ],
  };
}

export interface EscalationOptions {
  /** Local files on the item, for the sentence "so the 3 local files are deleted". */
  fileCount: number;
  /** When the next level up is told if this is still unresolved. null at the last level. */
  nextAt?: string | null;
  by?: Person | undefined;
}

/**
 * Escalation notice. Level 1 is the direct manager, level 2 their manager, and so on. Slack gives a DM no colour, so
 * the lead line carries the urgency.
 */
export function escalationMessage(item: Item, engineer: Person, level: number, c: MessageContext, o: EscalationOptions): SlackMessage {
  const text = `SLA missed: case #${item.caseNumber} (${engineer.name})`;
  const foot = `${level === 1 ? 'Manager notified at SLA breach' : `Escalation level ${level}`}${o.nextAt ? ` \u00b7 Escalates to ${escalationRole(level + 1)} ${utcAt(o.nextAt)} if unresolved.` : ' \u00b7 Last escalation level.'}`;
  return {
    text,
    blocks: [
      title(`:red_circle: ${level === 1 ? 'A cleanup item needs your follow-up.' : 'A cleanup item is still unresolved.'}`),
      section(
        `${esc(engineer.name)} has 1 overdue cleanup item from ${caseRef(item)}. Please follow up so the ${plural(o.fileCount, 'local file')} ${o.fileCount === 1 ? 'is' : 'are'} deleted or an approved exception is recorded.` +
          (o.by ? `\n_Escalated by ${esc(o.by.name)}._` : ''),
      ),
      fields(['Case', caseRef(item)], ['Deadline missed', utcFull(item.dueAt)]),
      {
        type: 'actions',
        elements: [
          button(ACTION.OPEN_WEB, 'Review overdue item', { url: itemUrl(c, item), primary: true }),
          button(ACTION.OPEN_TEAM, 'View team cleanup', { url: `${c.webUrl}/team` }),
        ],
      },
      context(foot),
      context(`Private message${level === 1 ? ' to the direct manager' : ''} \u00b7 Case access follows the reporting hierarchy.`),
    ],
  };
}

const fileList = (files: ItemFile[]): string => {
  const shown = files.slice(0, 10).map((f) => `\u2022 \`${f.filename.replace(/\`/g, "'")}\``);
  const more = files.length - shown.length;
  return [...shown, ...(more > 0 ? [`_+${more} more_`] : [])].join('\n');
};

export function filesAddedMessage(item: Item, added: ItemFile[]): SlackMessage {
  return { text: `More files reported for case #${item.caseNumber}`, blocks: [section(`:paperclip: *More downloads reported* for ${caseRef(item)}:\n${fileList(added)}`)] };
}

export function reopenedNotice(item: Item): SlackMessage {
  return { text: `Case #${item.caseNumber} reopened`, blocks: [section(`:arrows_counterclockwise: ${caseRef(item)} was reopened because new downloads were reported.`)] };
}

export function reassignedNotice(item: Item, to: Person): SlackMessage {
  return { text: `Case #${item.caseNumber} reassigned`, blocks: [section(`:arrow_right: ${caseRef(item)} was reassigned to *${esc(to.name)}*.`)] };
}
