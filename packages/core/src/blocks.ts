// Slack Block Kit builders. Paste the `blocks` JSON into https://app.slack.com/block-kit-builder to preview.
import type { Button, KnownBlock, ModalView } from '@slack/types';
import { ATTESTATION_LABEL, ATTESTATION_KINDS, displayStatus, type Item, type ItemFile, type Person } from '@dd/shared';

export interface SlackMessage {
  text: string;
  blocks: KnownBlock[];
}

export const ACTION = { ACK: 'dd_ack', CONFIRM: 'dd_confirm', OPEN_WEB: 'dd_open_web' } as const;
export const ATTEST_MODAL = 'dd_attest_modal';

/** Slack mrkdwn control characters. */
export const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const header = (text: string): KnownBlock => ({ type: 'header', text: { type: 'plain_text', text: text.slice(0, 150), emoji: true } });
const section = (text: string): KnownBlock => ({ type: 'section', text: { type: 'mrkdwn', text: text.slice(0, 2900) } });
const context = (text: string): KnownBlock => ({ type: 'context', elements: [{ type: 'mrkdwn', text }] });

/** Renders in each reader's own timezone. */
export const slackDate = (iso: string): string => {
  const secs = Math.floor(new Date(iso).getTime() / 1000);
  return `<!date^${secs}^{date_short_pretty}|${iso.slice(0, 10)}>`;
};

export interface MessageContext {
  webUrl: string;
  now: Date;
}

const itemUrl = (c: MessageContext, item: Item) => `${c.webUrl}/items/${item.id}`;

function fileList(files: ItemFile[]): string {
  const shown = files.slice(0, 10).map((f) => `• \`${f.filename.replace(/`/g, "'")}\``);
  const more = files.length - shown.length;
  return [...shown, ...(more > 0 ? [`_+${more} more_`] : [])].join('\n');
}

function statusLine(item: Item, now: Date): string {
  switch (displayStatus(item.state, new Date(item.dueAt), now)) {
    case 'closed': {
      const what = item.attestationKind ? ATTESTATION_LABEL[item.attestationKind] : 'Resolved';
      return `:white_check_mark: *Closed.* ${esc(what)}${item.attestationNotes ? `: ${esc(item.attestationNotes)}` : ''}`;
    }
    case 'acknowledged': return ':eyes: *Acknowledged.* Still needs confirmation.';
    case 'overdue': return `:rotating_light: *Overdue.* It was due ${slackDate(item.dueAt)}.`;
    default: return `:hourglass_flowing_sand: *Open.* Due ${slackDate(item.dueAt)}.`;
  }
}

/** The engineer's message. Re-rendered in place as the item moves through its lifecycle. */
export function itemMessage(item: Item, files: ItemFile[], c: MessageContext): SlackMessage {
  const title = `Action needed: Salesforce case #${item.caseNumber}`;
  const blocks: KnownBlock[] = [
    header(title),
    section(
      `${item.caseSubject ? `*${esc(item.caseSubject)}*\n` : ''}You downloaded these files from a closed Salesforce case. ` +
        'Please delete your local copies, or confirm they are stored in an approved location.',
    ),
    section(fileList(files)),
    context(`${item.ref} · Case closed ${slackDate(item.caseClosedAt)} · Due ${slackDate(item.dueAt)}`),
    section(statusLine(item, c.now)),
  ];
  const buttons: Button[] = [];
  if (item.state === 'open') {
    buttons.push({ type: 'button', action_id: ACTION.ACK, value: String(item.id), text: { type: 'plain_text', text: 'Acknowledge' } });
  }
  if (item.state === 'open' || item.state === 'acknowledged') {
    buttons.push({ type: 'button', action_id: ACTION.CONFIRM, value: String(item.id), style: 'primary', text: { type: 'plain_text', text: 'Confirm action taken' } });
  }
  buttons.push({ type: 'button', action_id: ACTION.OPEN_WEB, url: itemUrl(c, item), text: { type: 'plain_text', text: 'View details' } });
  blocks.push({ type: 'actions', elements: buttons });
  return { text: title, blocks };
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

export function reminderMessage(item: Item, c: MessageContext): SlackMessage {
  const text = `Reminder: case #${item.caseNumber} cleanup is still open`;
  return {
    text,
    blocks: [section(`:bell: *Reminder.* Cleanup for case #${esc(item.caseNumber)} (${item.ref}) is due ${slackDate(item.dueAt)}.`),
      { type: 'actions', elements: [{ type: 'button', action_id: ACTION.OPEN_WEB, url: itemUrl(c, item), text: { type: 'plain_text', text: 'View details' } }] }],
  };
}

export function manualReminderMessage(item: Item, by: Person, c: MessageContext): SlackMessage {
  const text = `${by.name} sent a reminder for case #${item.caseNumber}`;
  return {
    text,
    blocks: [section(`:bell: *${esc(by.name)}* sent a reminder: cleanup for case #${esc(item.caseNumber)} (${item.ref}) is due ${slackDate(item.dueAt)}.`),
      { type: 'actions', elements: [{ type: 'button', action_id: ACTION.OPEN_WEB, url: itemUrl(c, item), text: { type: 'plain_text', text: 'View details' } }] }],
  };
}

export function escalationMessage(item: Item, engineer: Person, level: 'manager' | 'director', c: MessageContext, by?: Person): SlackMessage {
  const text = `SLA missed: case #${item.caseNumber} (${engineer.name})`;
  const lead = level === 'manager' ? 'SLA missed' : 'Still unresolved after escalation';
  return {
    text,
    blocks: [
      header(lead),
      section(
        `*${esc(engineer.name)}* has not completed the cleanup for case #${esc(item.caseNumber)} (${item.ref}). It was due ${slackDate(item.dueAt)}.` +
          (by ? `\nEscalated by ${esc(by.name)}.` : ''),
      ),
      { type: 'actions', elements: [{ type: 'button', action_id: ACTION.OPEN_WEB, url: itemUrl(c, item), style: 'danger', text: { type: 'plain_text', text: 'Review item' } }] },
    ],
  };
}

export function filesAddedMessage(item: Item, added: ItemFile[]): SlackMessage {
  return { text: `More files reported for case #${item.caseNumber}`, blocks: [section(`:paperclip: *More downloads reported* for case #${esc(item.caseNumber)}:\n${fileList(added)}`)] };
}

export function reopenedNotice(item: Item): SlackMessage {
  return { text: `Case #${item.caseNumber} reopened`, blocks: [section(`:arrows_counterclockwise: Case #${esc(item.caseNumber)} was reopened because new downloads were reported.`)] };
}

export function reassignedNotice(item: Item, to: Person): SlackMessage {
  return { text: `Case #${item.caseNumber} reassigned`, blocks: [section(`:arrow_right: Case #${esc(item.caseNumber)} (${item.ref}) was reassigned to *${esc(to.name)}*.`)] };
}
