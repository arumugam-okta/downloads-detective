import type { Person } from './types.ts';

export function childrenMap(people: Person[]): Map<number, Person[]> {
  const m = new Map<number, Person[]>();
  for (const p of people) {
    if (p.managerId === null || !p.active) continue;
    const list = m.get(p.managerId) ?? [];
    list.push(p);
    m.set(p.managerId, list);
  }
  return m;
}

/** The person and everyone below them. */
export function subtreeIds(people: Person[], rootId: number): Set<number> {
  const kids = childrenMap(people);
  const out = new Set<number>([rootId]);
  const stack = [rootId];
  while (stack.length) {
    for (const c of kids.get(stack.pop()!) ?? []) {
      if (!out.has(c.id)) {
        out.add(c.id);
        stack.push(c.id);
      }
    }
  }
  return out;
}

/** Manager first, then their manager, and so on up. Cycle-safe. */
export function managerChain(people: Person[], personId: number): Person[] {
  const byId = new Map(people.map((p) => [p.id, p]));
  const chain: Person[] = [];
  const seen = new Set<number>([personId]);
  let cur = byId.get(personId);
  while (cur?.managerId != null && !seen.has(cur.managerId)) {
    const next = byId.get(cur.managerId);
    if (!next) break;
    chain.push(next);
    seen.add(next.id);
    cur = next;
  }
  return chain;
}

/** Who is told as an item stays overdue, nearest first: level 1 is the direct manager. Deactivated managers are skipped. */
export function escalationChain(people: Person[], engineerId: number): Person[] {
  return managerChain(people, engineerId).filter((p) => p.active);
}

/** "manager", "director", then "level 3 leader"... for audit text and copy. */
export const escalationRole = (level: number): string => (level === 1 ? 'manager' : level === 2 ? 'director' : `level ${level} leader`);

export type Role = 'engineer' | 'manager' | 'compliance';

export interface Viewer {
  person: Person;
  roles: Role[];
  /** People whose items this viewer may see in the given role. */
  scopeIds: Record<Role, Set<number>>;
}

/** Everyone is an engineer. Manager is granted explicitly or implied by having reports; compliance is an explicit grant. */
export function buildViewer(people: Person[], person: Person): Viewer {
  const kids = childrenMap(people);
  const leads = (kids.get(person.id)?.length ?? 0) > 0;
  const isManager = leads || person.isManager;
  const roles: Role[] = ['engineer'];
  if (isManager) roles.push('manager');
  if (person.isCompliance) roles.push('compliance');
  return {
    person,
    roles,
    scopeIds: {
      engineer: new Set([person.id]),
      manager: leads ? subtreeIds(people, person.id) : new Set([person.id]),
      compliance: new Set(people.map((p) => p.id)),
    },
  };
}

export const highestRole = (v: Viewer): Role =>
  v.roles.includes('compliance') ? 'compliance' : v.roles.includes('manager') ? 'manager' : 'engineer';

/** Units a viewer may scope to in the "Whole org > division > team" combobox. */
export interface ScopeOption {
  id: number;
  label: string;
  depth: number;
}

export function scopeOptions(people: Person[], rootId: number): ScopeOption[] {
  const kids = childrenMap(people);
  const out: ScopeOption[] = [];
  const walk = (p: Person, depth: number) => {
    const sub = kids.get(p.id);
    if (!sub?.length) return; // only units that lead someone
    out.push({ id: p.id, label: p.team ?? p.name, depth });
    for (const c of sub) walk(c, depth + 1);
  };
  const root = people.find((p) => p.id === rootId);
  if (root) walk(root, 0);
  return out;
}

/** The top of the hierarchy: the active person with no manager who leads the most people. */
export function orgRoot(people: Person[]): Person | undefined {
  const tops = people.filter((p) => p.active && p.managerId === null);
  return tops.sort((a, b) => subtreeIds(people, b.id).size - subtreeIds(people, a.id).size)[0];
}
