import { z } from 'zod';

/** Stored lifecycle. "overdue" is derived (see isOverdue), never stored. */
export const ITEM_STATES = ['open', 'acknowledged', 'closed', 'triage', 'failed'] as const;
export type ItemState = (typeof ITEM_STATES)[number];

export const ATTESTATION_KINDS = ['deleted', 'approved_location', 'not_applicable'] as const;
export type AttestationKind = (typeof ATTESTATION_KINDS)[number];

export const ATTESTATION_LABEL: Record<AttestationKind, string> = {
  deleted: 'Deleted all local copies',
  approved_location: 'Moved to an approved location',
  not_applicable: 'Not applicable',
};

/** Notes are required unless the engineer deleted the files (Figma: "Attestation + conditional notes"). */
export const attestationInput = z
  .object({
    kind: z.enum(ATTESTATION_KINDS),
    notes: z.string().trim().max(2000).optional(),
  })
  .refine((v) => v.kind === 'deleted' || (v.notes && v.notes.length > 0), {
    message: 'Notes are required unless the files were deleted',
    path: ['notes'],
  });
export type AttestationInput = z.infer<typeof attestationInput>;

const TRANSITIONS: Record<ItemState, ItemState[]> = {
  triage: ['open', 'failed', 'closed'], // mapped later; or the engineer confirms on the web
  failed: ['open', 'triage', 'closed'], // after a retry; or the engineer confirms on the web
  open: ['acknowledged', 'closed'],
  acknowledged: ['closed'],
  closed: ['open'], // only when new downloads arrive for an already-closed case
};

export const canTransition = (from: ItemState, to: ItemState): boolean => TRANSITIONS[from].includes(to);

export const isOpenState = (s: ItemState): boolean => s === 'open' || s === 'acknowledged';

export const isOverdue = (state: ItemState, dueAt: Date, now: Date): boolean => isOpenState(state) && now > dueAt;

/** The status shown in the UI. Overdue wins over open/acknowledged. */
export type DisplayStatus = ItemState | 'overdue';
export const displayStatus = (state: ItemState, dueAt: Date, now: Date): DisplayStatus =>
  isOverdue(state, dueAt, now) ? 'overdue' : state;
