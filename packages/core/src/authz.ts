import { managerChain, type Person } from '@dd/shared';
import { HttpError } from './errors.ts';

/** Only the assigned engineer may acknowledge or attest. */
export function requireEngineer(actor: Person, engineerId: number): void {
  if (actor.id !== engineerId) throw new HttpError(403, 'Only the assigned engineer can do this');
}

/** Managers act on their sub-tree (direct and indirect reports); compliance acts on everyone. */
export function requireManagerOf(actor: Person, engineerId: number, people: Person[]): void {
  if (actor.isCompliance) return;
  if (!managerChain(people, engineerId).some((m) => m.id === actor.id)) {
    throw new HttpError(403, 'You can only act on items for people in your reporting line');
  }
}

export function requireCompliance(actor: Person): void {
  if (!actor.isCompliance) throw new HttpError(403, 'Compliance access required');
}
