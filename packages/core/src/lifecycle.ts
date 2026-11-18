import {
  ATTESTATION_LABEL, SYSTEM_ACTOR, attestationInput, dueAtFor, escalationChain, escalationDueAt, MAX_ESCALATION_LEVELS,
  SLACK_ID_RE, type AttestationInput, type Item, type PeopleCsvInspection, type PeopleImportResult, type PeopleMapping, type Person, type PersonInput, type Policy, type SlackDirectoryView, type SlackSyncRequest, type SlackSyncResult, suggestSlackMapping,
} from '@dd/shared';
import { fingerprintOf, type NewAudit, type Store } from '@dd/db';
import {
  escalationMessage, filesAddedMessage, itemMessage, manualReminderMessage, reassignedNotice, reopenedNotice,
  type MessageContext, type SlackMessage,
} from './blocks.ts';
import { requireCompliance, requireEngineer, requireManagerOf } from './authz.ts';
import { HttpError } from './errors.ts';
import { nameFromEmail, parseReport } from './ingest.ts';
import { inspectPeopleCsv, planPeopleImport, wouldCycle } from './people-import.ts';
import { planSlackSync } from './slack-sync.ts';
import type { Notifier } from './notifier.ts';
import { z, ZodError } from 'zod';

export interface LifecycleDeps {
  store: Store;
  notifier: Notifier;
  webUrl: string;
  /** Where the SLA clock starts when the report carries no case-closed date. */
  closedFallback: 'received' | 'downloaded';
  clock?: () => Date;
}

export interface ReportSummary {
  importId: number;
  rowsTotal: number;
  duplicateRows: number;
  invalidRows: number;
  itemsCreated: number;
  itemsUpdated: number;
  needsTriage: number;
  failed: number;
  /** Items created while Slack is paused. They are delivered when it is switched back on. */
  held: number;
}

/** 'paused' means Slack messaging is switched off, so the item is held until it is switched back on. */
export type DeliveryResult = 'delivered' | 'triage' | 'failed' | 'paused';

const SYSTEM = { actorId: null, actorLabel: SYSTEM_ACTOR } as const;
const person = (p: Person) => ({ actorId: p.id, actorLabel: p.name });

export class Lifecycle {
  constructor(readonly deps: LifecycleDeps) {}

  get store() { return this.deps.store; }

  private policyCache: { at: number; policy: Policy } | null = null;
  /** Policy with a few seconds of cache, because every outbound message checks it. Saving a policy clears it. */
  async policy(): Promise<Policy> {
    if (this.policyCache && Date.now() - this.policyCache.at < 5_000) return this.policyCache.policy;
    const policy = await this.store.getPolicy();
    this.policyCache = { at: Date.now(), policy };
    return policy;
  }
  async slackEnabled(): Promise<boolean> { return (await this.policy()).slackEnabled; }
  /** For actions whose whole point is sending a message: say so rather than silently doing nothing. */
  async requireSlack(): Promise<void> {
    if (!(await this.slackEnabled())) throw new HttpError(409, 'Slack messaging is paused. Turn it back on in Settings to send messages.');
  }
  now(): Date { return this.deps.clock?.() ?? new Date(); }
  ctx(): MessageContext { return { webUrl: this.deps.webUrl, now: this.now() }; }

  async audit(e: NewAudit): Promise<void> {
    await this.store.appendAudit({ at: this.now().toISOString(), ...e });
  }

  async mustItem(id: number): Promise<Item> {
    const item = await this.store.getItem(id);
    if (!item) throw new HttpError(404, `Item ${id} not found`);
    return item;
  }
  async mustPerson(id: number): Promise<Person> {
    const p = await this.store.getPerson(id);
    if (!p) throw new HttpError(404, `Person ${id} not found`);
    return p;
  }

  /** Best-effort Slack calls after the state change has been saved; a Slack outage must not undo a confirmation. */
  private async quiet(what: string, fn: () => Promise<unknown>): Promise<void> {
    try { await fn(); } catch (e) { console.error(`[slack] ${what} failed: ${(e as Error).message}`); }
  }

  async refreshMessage(itemId: number): Promise<void> {
    const item = await this.mustItem(itemId);
    if (!item.slackChannel || !item.slackTs || !(await this.slackEnabled())) return;
    const [files, engineer] = await Promise.all([this.store.listFiles([itemId]), this.mustPerson(item.engineerId)]);
    await this.quiet('update message', () =>
      this.deps.notifier.update({ channel: item.slackChannel!, ts: item.slackTs! }, itemMessage(item, files, engineer, this.ctx())));
  }

  /** A fresh DM to the item's engineer (not a thread reply, so Slack notifies them). */
  private async nudge(item: Item, msg: SlackMessage): Promise<void> {
    if (!item.slackChannel || !(await this.slackEnabled())) return;
    await this.quiet('direct message', () => this.deps.notifier.sendInDm(item.slackChannel!, msg));
  }

  /** DM anyone by Person, caching the Slack id. Returns false when they have no Slack account. */
  async dmPerson(p: Person, msg: SlackMessage): Promise<boolean> {
    if (!(await this.slackEnabled())) return false;
    let id = p.slackUserId;
    if (!id) {
      id = await this.deps.notifier.lookupUserByEmail(p.email);
      if (id) await this.store.updatePerson(p.id, { slackUserId: id });
    }
    if (!id) return false;
    await this.deps.notifier.sendDirect(id, msg);
    return true;
  }

  // ---------------------------------------------------------------- ingest

  async processReport(csv: string, meta: { filename: string; source: string }): Promise<ReportSummary> {
    const { rows, invalid } = parseReport(csv);
    const { store } = this;
    const imp = await store.createImport({ filename: meta.filename, source: meta.source });
    const receivedAt = this.now();

    for (const bad of invalid) {
      await store.addIssue({ importId: imp.id, itemId: null, rowNo: bad.rowNo, downloadedBy: bad.downloadedBy, issue: bad.reason, kind: 'failed' });
    }

    const keyed = rows.map((r) => ({ r, fp: fingerprintOf({ downloadedBy: r.downloadedBy, caseNumber: r.caseNumber, filename: r.filename, downloadedOn: r.downloadedOn }) }));
    const existing = await store.existingFingerprints(keyed.map((k) => k.fp));
    const seen = new Set<string>();
    let duplicateRows = 0;
    const fresh = keyed.filter((k) => {
      if (existing.has(k.fp) || seen.has(k.fp)) { duplicateRows++; return false; }
      seen.add(k.fp);
      return true;
    });

    const groups = new Map<string, typeof fresh>();
    for (const k of fresh) {
      const key = `${k.r.downloadedBy}|${k.r.caseNumber}`;
      groups.set(key, [...(groups.get(key) ?? []), k]);
    }

    const policy = await store.getPolicy();
    const created: number[] = [];
    const appended: Array<{ itemId: number; filenames: Set<string> }> = [];
    const reopened: number[] = [];

    for (const group of groups.values()) {
      const first = group[0]!.r;
      const engineer = await store.upsertPersonByEmail({ email: first.downloadedBy, name: group.find((g) => g.r.downloadedByName)?.r.downloadedByName ?? nameFromEmail(first.downloadedBy) });
      const closedOn = group.map((g) => g.r.caseClosedOn).find(Boolean)
        ?? (this.deps.closedFallback === 'downloaded' ? group.map((g) => g.r.downloadedOn).sort()[0]! : receivedAt.toISOString());
      let item = await store.findItem(engineer.id, first.caseNumber);
      let isNew = false;

      if (!item) {
        item = await store.createItem({
          engineerId: engineer.id, caseNumber: first.caseNumber, caseSubject: group.find((g) => g.r.caseSubject)?.r.caseSubject ?? null,
          caseClosedAt: closedOn, dueAt: dueAtFor(new Date(closedOn), policy).toISOString(), state: 'open', createdImportId: imp.id,
        });
        isNew = true;
        created.push(item.id);
        await this.audit({ ...SYSTEM, itemId: item.id, importId: imp.id, action: 'case_created', detail: `Created cleanup item ${item.ref} (Case #${item.caseNumber})` });
      } else if (item.state === 'closed') {
        // New downloads after a confirmed cleanup start a fresh SLA window.
        item = await store.updateItem(item.id, {
          state: 'open', dueAt: dueAtFor(receivedAt, policy).toISOString(), acknowledgedAt: null, remindersSent: [], escalationsSent: [], escalatedAt: null,
          attestationKind: null, attestationNotes: null, attestedAt: null, reviewedBy: null, reviewedAt: null,
        });
        reopened.push(item.id);
        await this.audit({ ...SYSTEM, itemId: item.id, importId: imp.id, action: 'reopened', detail: 'Reopened: new downloads reported for a closed case' });
      }

      await store.addFiles(group.map((g) => ({ fingerprint: g.fp, itemId: item!.id, filename: g.r.filename, downloadedOn: g.r.downloadedOn })));
      for (const g of group) await this.audit({ ...SYSTEM, itemId: item.id, importId: imp.id, action: 'file_added', detail: g.r.filename });
      if (!isNew) appended.push({ itemId: item.id, filenames: new Set(group.map((g) => g.r.filename)) });
    }

    let needsTriage = 0;
    let held = 0;
    let failed = invalid.length;
    for (const id of created) {
      const result = await this.deliver(id, imp.id);
      if (result === 'triage') needsTriage++;
      if (result === 'failed') failed++;
      if (result === 'paused') held++;
    }
    for (const a of appended) {
      await this.quiet(`append files to ${a.itemId}`, async () => {
        const item = await this.mustItem(a.itemId);
        const added = (await store.listFiles([a.itemId])).filter((f) => a.filenames.has(f.filename));
        if (reopened.includes(a.itemId)) await this.nudge(item, reopenedNotice(item));
        else await this.nudge(item, filesAddedMessage(item, added));
        await this.refreshMessage(a.itemId);
      });
    }

    await store.updateImport(imp.id, {
      rowsTotal: rows.length + invalid.length, duplicateRows, itemsCreated: created.length, itemsUpdated: appended.length, failures: failed,
    });
    await this.audit({ ...SYSTEM, importId: imp.id, action: 'report_ingested', detail: `Ingested ${rows.length + invalid.length} report rows` });
    return {
      importId: imp.id, rowsTotal: rows.length + invalid.length, duplicateRows, invalidRows: invalid.length,
      itemsCreated: created.length, itemsUpdated: appended.length, needsTriage, failed, held,
    };
  }

  // -------------------------------------------------------------- delivery

  /** Sends (or re-sends) the engineer's Slack message. Never throws: failure becomes item state. */
  async deliver(itemId: number, importId?: number): Promise<DeliveryResult> {
    const { store, deps } = this;
    // Held, not failed: the item stays open without a Slack message and is delivered when messaging resumes.
    if (!(await this.slackEnabled())) return 'paused';
    let item = await this.mustItem(itemId);
    const engineer = await this.mustPerson(item.engineerId);
    const unresolved = async () => (await store.listIssues({ unresolvedOnly: true })).filter((i) => i.itemId === itemId);
    const raise = async (issue: string, kind: 'triage' | 'failed') => {
      if ((await unresolved()).length) return;
      await store.addIssue({ importId: importId ?? item.createdImportId ?? 0, itemId, rowNo: null, downloadedBy: engineer.email, issue, kind });
    };

    try {
      let slackId = engineer.slackUserId;
      if (!slackId) {
        slackId = await deps.notifier.lookupUserByEmail(engineer.email);
        if (slackId) await store.updatePerson(engineer.id, { slackUserId: slackId });
      }
      if (!slackId) {
        const reason = 'No Slack user found for this email';
        item = await store.updateItem(itemId, { state: 'triage', error: reason });
        await raise(reason, 'triage');
        await this.audit({ ...SYSTEM, itemId, importId: item.createdImportId, action: 'triage_flagged', detail: `No Slack user found for ${engineer.email}` });
        return 'triage';
      }

      if (item.state === 'triage' || item.state === 'failed') item = await store.updateItem(itemId, { state: 'open', error: null });
      const files = await store.listFiles([itemId]);
      const sent = await deps.notifier.sendDirect(slackId, itemMessage(item, files, engineer, this.ctx()));
      await store.updateItem(itemId, { slackChannel: sent.channel, slackTs: sent.ts, error: null });
      for (const issue of await unresolved()) await store.resolveIssue(issue.id);
      await this.audit({ ...SYSTEM, itemId, importId: item.createdImportId, action: 'slack_notified', detail: `Sent Slack message to ${engineer.name}` });
      return 'delivered';
    } catch (e) {
      const reason = (e as Error).message;
      await store.updateItem(itemId, { state: 'failed', error: reason });
      await raise(reason, 'failed');
      await this.audit({ ...SYSTEM, itemId, importId: item.createdImportId, action: 'delivery_failed', detail: reason });
      return 'failed';
    }
  }

  // --------------------------------------------------------- engineer actions

  async acknowledge(itemId: number, actor: Person): Promise<Item> {
    const item = await this.mustItem(itemId);
    requireEngineer(actor, item.engineerId);
    if (item.state !== 'open') return item; // idempotent: a double click or an already-acknowledged item
    const updated = await this.store.updateItem(itemId, { state: 'acknowledged', acknowledgedAt: this.now().toISOString() });
    await this.audit({ ...person(actor), itemId, action: 'acknowledged', detail: 'Acknowledged' });
    await this.refreshMessage(itemId);
    return updated;
  }

  async attest(itemId: number, actor: Person, raw: unknown): Promise<Item> {
    const item = await this.mustItem(itemId);
    requireEngineer(actor, item.engineerId);
    if (item.state === 'closed') return item;
    let input: AttestationInput;
    try {
      input = attestationInput.parse(raw);
    } catch (e) {
      if (e instanceof ZodError) throw new HttpError(400, e.issues.map((i) => i.message).join('; '));
      throw e;
    }
    const updated = await this.store.updateItem(itemId, {
      state: 'closed', attestationKind: input.kind, attestationNotes: input.notes?.trim() || null,
      attestedAt: this.now().toISOString(), error: null,
    });
    for (const issue of (await this.store.listIssues({ unresolvedOnly: true })).filter((i) => i.itemId === itemId)) await this.store.resolveIssue(issue.id);
    await this.audit({ ...person(actor), itemId, action: 'attested', detail: `Attested: ${ATTESTATION_LABEL[input.kind].toLowerCase()}` });
    await this.refreshMessage(itemId);
    return updated;
  }

  // ---------------------------------------------------------- manager actions

  async remind(itemId: number, by: Person): Promise<Item> {
    await this.requireSlack();
    const item = await this.mustItem(itemId);
    requireManagerOf(by, item.engineerId, await this.store.listPeople());
    if (item.state === 'closed') throw new HttpError(409, 'This item is already closed');
    if (!item.slackChannel) throw new HttpError(409, 'This item has not been delivered in Slack yet');
    const files = await this.store.listFiles([itemId]);
    await this.deps.notifier.sendInDm(item.slackChannel, manualReminderMessage(item, files.length, by, this.ctx()));
    await this.audit({ ...person(by), itemId, action: 'manual_reminder', detail: 'Sent manual reminder' });
    return item;
  }

  async escalate(itemId: number, by: Person): Promise<Item> {
    await this.requireSlack();
    const item = await this.mustItem(itemId);
    const people = await this.store.listPeople();
    requireManagerOf(by, item.engineerId, people);
    if (item.state === 'closed') throw new HttpError(409, 'This item is already closed');
    const engineer = await this.mustPerson(item.engineerId);
    const chain = escalationChain(people, engineer.id);
    // A manager escalating goes one step above themselves; compliance goes to the next level not yet told.
    const own = chain.findIndex((m) => m.id === by.id);
    const level = own >= 0 ? own + 2 : Math.max(0, ...item.escalationsSent) + 1;
    const target = chain[level - 1];
    if (!target) {
      throw new HttpError(409, own >= 0 ? 'There is no one above you in the reporting line' : item.escalationsSent.length
        ? 'This item has already been escalated to everyone in the reporting line' : `No manager is on record for ${engineer.name}`);
    }
    const policy = await this.policy();
    const fileCount = (await this.store.listFiles([itemId])).length;
    const nextAt = level < policy.escalationLevels && chain[level] ? escalationDueAt(new Date(item.dueAt), level + 1, policy).toISOString() : null;
    if (!(await this.dmPerson(target, escalationMessage(item, engineer, level, this.ctx(), { fileCount, nextAt, by })))) {
      throw new HttpError(409, `${target.name} has no Slack account, so nobody could be notified. Map their Slack user on the Ingestion page first.`);
    }
    // Everything up to this level counts as told, so the scheduled escalation does not repeat it.
    const sent = [...new Set([...item.escalationsSent, ...Array.from({ length: level }, (_, i) => i + 1)])].sort((a, b) => a - b);
    const updated = await this.store.updateItem(itemId, { escalationsSent: sent, escalatedAt: this.now().toISOString() });
    await this.audit({ ...person(by), itemId, action: 'escalated', detail: `Escalated to ${target.name}` });
    return updated;
  }

  async reassign(itemId: number, toPersonId: number, by: Person): Promise<Item> {
    const item = await this.mustItem(itemId);
    requireManagerOf(by, item.engineerId, await this.store.listPeople());
    if (item.state === 'closed') throw new HttpError(409, 'Closed items cannot be reassigned');
    const to = await this.mustPerson(toPersonId);
    if (!to.active) throw new HttpError(409, `${to.name} is not active`);
    if (to.id === item.engineerId) return item;
    if (await this.store.findItem(to.id, item.caseNumber)) throw new HttpError(409, `${to.name} already has an item for case #${item.caseNumber}`);
    const from = await this.mustPerson(item.engineerId);

    const old = item.slackChannel && item.slackTs ? { channel: item.slackChannel, ts: item.slackTs } : null;
    await this.store.updateItem(itemId, { engineerId: to.id, state: 'open', error: null, acknowledgedAt: null, slackChannel: null, slackTs: null });
    if (old && (await this.slackEnabled())) await this.quiet('reassigned notice', () => this.deps.notifier.update(old, reassignedNotice(item, to)));
    await this.audit({ ...person(by), itemId, action: 'reassigned', detail: `Reassigned from ${from.name} to ${to.name}` });
    await this.deliver(itemId);
    return this.mustItem(itemId);
  }

  async review(itemId: number, by: Person): Promise<Item> {
    const item = await this.mustItem(itemId);
    requireManagerOf(by, item.engineerId, await this.store.listPeople());
    if (item.state !== 'closed' || !item.attestationKind) throw new HttpError(409, 'Only closed items with an attestation can be reviewed');
    if (item.reviewedAt) return item;
    const updated = await this.store.updateItem(itemId, { reviewedBy: by.id, reviewedAt: this.now().toISOString() });
    await this.audit({ ...person(by), itemId, action: 'attestation_reviewed', detail: 'Marked attestation reviewed' });
    return updated;
  }

  // -------------------------------------------------------- compliance actions

  /** Link a person to their Slack account (or look it up by email) and deliver everything that was waiting. */
  async mapSlackUser(personId: number, by: Person, slackUserId?: string): Promise<{ person: Person; delivered: number }> {
    requireCompliance(by);
    const p = await this.mustPerson(personId);
    const id = slackUserId ?? (await this.deps.notifier.lookupUserByEmail(p.email));
    if (!id) throw new HttpError(409, `No Slack user found for ${p.email}. Enter the Slack member ID instead.`);
    const updated = await this.store.updatePerson(personId, { slackUserId: id });
    await this.audit({ ...person(by), action: 'slack_user_mapped', detail: `Mapped Slack user: ${p.name}` });
    const waiting = await this.store.listItems({ engineerIds: [personId], states: ['triage', 'failed'] });
    let delivered = 0;
    for (const item of waiting) if ((await this.deliver(item.id)) === 'delivered') delivered++;
    return { person: updated, delivered };
  }

  async retryDelivery(itemId: number, by: Person): Promise<DeliveryResult> {
    requireCompliance(by);
    const item = await this.mustItem(itemId);
    if (item.state !== 'triage' && item.state !== 'failed') throw new HttpError(409, 'Only items that were not delivered can be retried');
    await this.requireSlack();
    const result = await this.deliver(itemId);
    await this.audit({ ...person(by), itemId, action: 'delivery_retried', detail: `Retried delivery: ${result}` });
    return result;
  }

  async retryAllFailed(by: Person): Promise<{ retried: number; delivered: number }> {
    requireCompliance(by);
    await this.requireSlack();
    const failed = await this.store.listItems({ states: ['failed'] });
    let delivered = 0;
    for (const item of failed) if ((await this.deliver(item.id)) === 'delivered') delivered++;
    await this.audit({ ...person(by), action: 'delivery_retried', detail: `Retried ${failed.length} failed deliveries` });
    return { retried: failed.length, delivered };
  }

  // ------------------------------------------------------------- settings

  /** Versioned: a change adds a row, so due dates already assigned are never recomputed. */
  // ---- user management (compliance only)

  inspectPeopleCsv(by: Person, csv: string): PeopleCsvInspection {
    requireCompliance(by);
    return inspectPeopleCsv(csv);
  }

  /** Validates a people CSV against the mapping. With dryRun it only reports; otherwise it writes and audits. */
  async importPeople(by: Person, csv: string, mapping: PeopleMapping, opts: { dryRun: boolean; filename?: string }): Promise<PeopleImportResult> {
    requireCompliance(by);
    const plan = planPeopleImport(csv, mapping, await this.store.listPeople(), by);
    const { planned, links, ...summary } = plan;
    if (opts.dryRun) return { ...summary, dryRun: true };
    if (plan.blocking) throw new HttpError(409, plan.blocking);

    const ids = new Map(planned.flatMap((p) => (p.existing ? [[p.email, p.existing.id] as const] : [])));
    for (const p of planned) {
      if (!p.existing) ids.set(p.email, (await this.store.upsertPersonByEmail(p.create)).id);
      else if (Object.keys(p.patch).length) await this.store.updatePerson(p.existing.id, p.patch);
    }
    const all = await this.store.listPeople();
    const idOf = new Map(all.map((x) => [x.email, x.id]));
    for (const [email, mgr] of links) await this.store.updatePerson(idOf.get(email)!, { managerId: idOf.get(mgr)!, managerSource: 'manual' });
    await this.audit({
      ...person(by), action: 'people_imported',
      detail: `${opts.filename ?? 'people.csv'}: ${plan.created} added, ${plan.updated} updated, ${plan.managersLinked} manager links`,
    });
    return { ...summary, dryRun: false };
  }

  private async validatePersonInput(by: Person, input: PersonInput, current: Person | null): Promise<Partial<Omit<Person, 'id'>>> {
    const people = await this.store.listPeople();
    const patch: Partial<Omit<Person, 'id'>> = {};
    const text = (v: string | null | undefined) => (v == null || v.trim() === '' ? null : v.trim());
    if (input.name !== undefined) {
      if (!input.name.trim()) throw new HttpError(400, 'Name is required');
      patch.name = input.name.trim();
    }
    if (input.email !== undefined) {
      const email = input.email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address');
      if (people.some((p) => p.email === email && p.id !== current?.id)) throw new HttpError(409, `${email} already exists`);
      patch.email = email;
    }
    if (input.title !== undefined) patch.title = text(input.title);
    if (input.team !== undefined) patch.team = text(input.team);
    if (input.slackUserId !== undefined) {
      const v = text(input.slackUserId)?.toUpperCase() ?? null;
      if (v && !SLACK_ID_RE.test(v)) throw new HttpError(400, 'Not a Slack member ID (looks like U01ABC23DE)');
      patch.slackUserId = v;
    }
    if (input.managerId !== undefined) {
      if (input.managerId !== null) {
        const m = people.find((p) => p.id === input.managerId);
        if (!m) throw new HttpError(400, 'That manager does not exist');
        if (!m.active) throw new HttpError(400, `${m.name} is deactivated and cannot manage anyone`);
        if (current && wouldCycle(people, current.id, m.id)) throw new HttpError(409, 'That would make someone their own manager');
      }
      patch.managerId = input.managerId;
      patch.managerSource = input.managerId === null ? null : 'manual';
    }
    if (input.isManager !== undefined) patch.isManager = input.isManager;
    if (input.isCompliance !== undefined) patch.isCompliance = input.isCompliance;
    if (input.active !== undefined) patch.active = input.active;

    if (current) {
      const stillCompliant = (p: Person) => (p.id === current.id ? (patch.isCompliance ?? p.isCompliance) && (patch.active ?? p.active) : p.isCompliance && p.active);
      if (!people.some(stillCompliant)) throw new HttpError(409, 'At least one active compliance user is required');
      if (current.id === by.id && (patch.isCompliance === false || patch.active === false)) throw new HttpError(409, 'You cannot remove your own compliance access or deactivate yourself');
    }
    return patch;
  }

  /**
   * Reads every person's Slack profile once and keeps the result for a few minutes, so the picker, the preview and
   * the final apply all work from the same data without hitting Slack's rate limits three times.
   */
  async readSlackDirectory(by: Person): Promise<SlackDirectoryView> {
    requireCompliance(by);
    const dir = await this.deps.notifier.listProfiles();
    if (!dir) throw new HttpError(409, 'Slack is not connected. Set SLACK_BOT_TOKEN and restart.');
    const snapshotId = crypto.randomUUID();
    const readAt = this.now().toISOString();
    this.snapshots.set(snapshotId, { dir, readAt, by: by.id });
    for (const [id, s] of this.snapshots) if (this.now().getTime() - new Date(s.readAt).getTime() > 15 * 60_000) this.snapshots.delete(id);
    return { snapshotId, readAt, fields: dir.fields, suggested: suggestSlackMapping(dir.fields), people: dir.profiles, failed: dir.failed.length };
  }

  private snapshots = new Map<string, { dir: NonNullable<Awaited<ReturnType<Lifecycle['deps']['notifier']['listProfiles']>>>; readAt: string; by: number }>();

  /**
   * Imports the people the user ticked, using the mapping they chose. With dryRun it only reports. Manager links set by
   * hand or CSV are kept; only links that came from Slack are refreshed.
   */
  async syncFromSlack(by: Person, req: SlackSyncRequest): Promise<SlackSyncResult> {
    requireCompliance(by);
    const snap = this.snapshots.get(req.snapshotId);
    if (!snap || snap.by !== by.id) throw new HttpError(409, 'That Slack read has expired. Reload the people list and try again.');
    if (!req.selected.length) throw new HttpError(400, 'Select at least one person');
    const known = new Set(snap.dir.fields.map((f) => f.key));
    for (const [t, k] of Object.entries(req.mapping)) if (k && !known.has(k)) throw new HttpError(400, `Unknown Slack field for ${t}`);

    const plan = planSlackSync(snap.dir.profiles, await this.store.listPeople(), { mapping: req.mapping, selected: new Set(req.selected), withChain: req.withChain, overwrite: req.overwrite });
    const { planned, links, ...summary } = plan;
    const issues = [...plan.issues, ...snap.dir.failed.map((f) => ({ rowNo: 0, email: f.slackUserId, level: 'warning' as const, message: `Profile could not be read: ${f.error}` }))];
    const syncedAt = this.now().toISOString();
    const result: SlackSyncResult = { ...summary, issues, dryRun: req.dryRun, syncedAt };
    if (req.dryRun) return result;

    for (const p of planned) {
      if (!p.existing) await this.store.upsertPersonByEmail({ ...p.create, slackSyncedAt: syncedAt });
      else if (Object.keys(p.patch).length) await this.store.updatePerson(p.existing.id, { ...p.patch, slackSyncedAt: syncedAt });
    }
    const all = await this.store.listPeople();
    const idOf = new Map(all.map((x) => [x.email, x.id]));
    for (const [email, mgr] of links) {
      const id = idOf.get(email), mid = idOf.get(mgr);
      if (id && mid) await this.store.updatePerson(id, { managerId: mid, managerSource: 'slack', slackSyncedAt: syncedAt });
    }
    await this.audit({ ...person(by), action: 'slack_synced', detail: `Slack import: ${plan.created} added, ${plan.updated} updated, ${plan.managersLinked} manager links (${plan.selected} selected${plan.chainAdded ? `, ${plan.chainAdded} managers added` : ''})` });
    return result;
  }

  async createPerson(by: Person, input: PersonInput): Promise<Person> {
    requireCompliance(by);
    if (!input.email) throw new HttpError(400, 'Email is required');
    const patch = await this.validatePersonInput(by, input, null);
    const email = patch.email!;
    const p = await this.store.upsertPersonByEmail({ ...patch, email, name: patch.name ?? nameFromEmail(email) });
    await this.audit({ ...person(by), action: 'person_added', detail: `Added ${p.name} (${p.email})` });
    return p;
  }

  async updatePersonDetails(by: Person, id: number, input: PersonInput): Promise<Person> {
    requireCompliance(by);
    const current = await this.mustPerson(id);
    const patch = await this.validatePersonInput(by, input, current);
    if (Object.keys(patch).length === 0) return current;
    const updated = await this.store.updatePerson(id, patch);
    const changes = Object.keys(patch).map((k) => k.replace(/[A-Z]/g, (c) => ` ${c.toLowerCase()}`)).join(', ');
    await this.audit({ ...person(by), action: patch.active === false ? 'person_deactivated' : patch.active === true && !current.active ? 'person_reactivated' : 'person_updated', detail: `${current.name}: changed ${changes}` });
    return updated;
  }

  async updatePolicy(by: Person, raw: unknown): Promise<Policy> {
    requireCompliance(by);
    const parsed = policyInput.safeParse(raw);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join('; '));
    // Only the fields on the form: the Slack switch has its own control and must survive a save of the form.
    const p: Policy = { ...(await this.store.getPolicy()), ...parsed.data };
    await this.store.setPolicy(p, by.id);
    this.policyCache = null;
    const route = p.escalationLevels === 0 ? 'no escalation' : `${p.escalationLevels} escalation level${p.escalationLevels === 1 ? '' : 's'}, ${p.escalationStepHours}h apart`;
    await this.audit({ actorId: by.id, actorLabel: by.name, action: 'policy_changed', detail: `SLA ${p.slaDays} days; reminders at ${p.reminderHours.join('h, ') || 'none'}${p.reminderHours.length ? 'h' : ''}; ${route}` });
    return p;
  }

  /**
   * The master switch for everything sent to Slack. Takes effect immediately, so it is its own action rather than a
   * field on the policy form. Turning it back on delivers what was held and refreshes messages that went stale.
   */
  async setSlackEnabled(by: Person, enabled: boolean): Promise<{ enabled: boolean; delivered: number; refreshed: number }> {
    requireCompliance(by);
    const cur = await this.store.getPolicy();
    if (cur.slackEnabled === enabled) return { enabled, delivered: 0, refreshed: 0 };
    const now = this.now().toISOString();
    await this.store.setPolicy(enabled ? { ...cur, slackEnabled: true, slackResumedAt: now, slackPausedAt: null } : { ...cur, slackEnabled: false, slackPausedAt: now }, by.id);
    this.policyCache = null;
    await this.audit({ ...person(by), action: enabled ? 'slack_resumed' : 'slack_paused', detail: enabled ? 'Turned Slack messaging on' : 'Turned Slack messaging off' });
    if (!enabled) return { enabled, delivered: 0, refreshed: 0 };

    // Deliver what was held, then bring messages up to date for anything done on the web while it was off.
    let delivered = 0;
    for (const item of await this.store.listItems({ states: ['open'] })) if (!item.slackChannel && (await this.deliver(item.id)) === 'delivered') delivered++;
    const since = cur.slackPausedAt;
    let refreshed = 0;
    if (since) {
      for (const item of await this.store.listItems()) {
        if (!item.slackChannel || !item.slackTs) continue;
        if ((item.attestedAt && item.attestedAt >= since) || (item.acknowledgedAt && item.acknowledgedAt >= since)) { await this.refreshMessage(item.id); refreshed++; }
      }
    }
    return { enabled, delivered, refreshed };
  }
}

const policyInput = z.object({
  slaDays: z.number().int().min(1).max(30),
  reminderHours: z.array(z.number().int().min(1)).max(5),
  escalationLevels: z.number().int().min(0).max(MAX_ESCALATION_LEVELS),
  escalationStepHours: z.number().int().min(1).max(168),
});
