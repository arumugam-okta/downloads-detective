import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { createStore, type Store } from '@dd/db';
import {
  buildViewer, highestRole, orgRoot, scopeOptions, subtreeIds, type Item, type ItemFile, type Person, type Role, type ScopeOption, type Viewer,
} from '@dd/shared';
import { relevantInRange, toViews, type ItemView, type Range } from './metrics';

const g = globalThis as unknown as { __ddStore?: Store };
/** One client per server process. */
export const getStore = async (): Promise<Store> => (g.__ddStore ??= createStore());

/** OAP forwards the signed-in user's email in this header. */
const IDENTITY_HEADER = process.env.IDENTITY_HEADER ?? 'x-iddb-user-email';
const devAuth = () => process.env.DEV_AUTH !== 'off' && process.env.NODE_ENV !== 'production';

export const ROLE_HOME: Record<Role, string> = { engineer: '/cleanup', manager: '/team', compliance: '/overview' };
export const ROLE_LABEL: Record<Role, string> = { engineer: 'Engineer', manager: 'Manager', compliance: 'Compliance' };

export interface World {
  now: Date;
  people: Person[];
  items: Item[];
  files: ItemFile[];
}

/** Comma-separated emails that become compliance users on first sign-in (the trusted gateway header proves the email). */
const bootstrapAdmins = (): Set<string> =>
  new Set((process.env.BOOTSTRAP_COMPLIANCE_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean));

const nameFromEmail = (email: string): string =>
  (email.split('@')[0] ?? email).split(/[._-]+/).filter(Boolean).map((p) => p[0]!.toUpperCase() + p.slice(1)).join(' ');

export const loadWorld = cache(async (): Promise<World> => {
  const store = await getStore();
  const [people, items] = await Promise.all([store.listPeople(), store.listItems()]);
  const files = await store.listFiles(items.map((i) => i.id));
  return { now: new Date(), people, items, files };
});

export interface Session {
  world: World;
  viewer: Viewer;
  /** The role the UI is currently showing (a role the viewer actually holds). */
  role: Role;
}

export class NoAccessError extends Error {}

export const getSession = cache(async (): Promise<Session> => {
  const h = await headers();
  const c = await cookies();
  const email = (h.get(IDENTITY_HEADER) ?? (devAuth() ? c.get('dd_user')?.value ?? process.env.DEV_DEFAULT_USER ?? [...bootstrapAdmins()][0] ?? null : null))?.toLowerCase();
  if (!email) throw new NoAccessError('Not signed in');
  let world = await loadWorld();
  let person = world.people.find((p) => p.email === email && p.active);
  if (!person && bootstrapAdmins().has(email)) {
    // First sign-in for a listed admin: create their compliance record so the directory can be set up.
    const store = await getStore();
    const created = await store.upsertPersonByEmail({ email, name: nameFromEmail(email), isCompliance: true });
    if (!created.isCompliance) await store.updatePerson(created.id, { isCompliance: true });
    world = { ...world, people: await store.listPeople() };
    person = world.people.find((p) => p.email === email);
  }
  if (!person) throw new NoAccessError(`${email} is not in the Downloads Detective directory yet`);
  const viewer = buildViewer(world.people, person);
  const want = c.get('dd_role')?.value as Role | undefined;
  const role = want && viewer.roles.includes(want) ? want : highestRole(viewer);
  return { world, viewer, role };
});

export async function requireRole(...allowed: Role[]): Promise<Session> {
  const s = await getSession();
  if (!allowed.some((r) => s.viewer.roles.includes(r))) throw new NoAccessError(`This page needs ${allowed.map((r) => ROLE_LABEL[r]).join(' or ')} access`);
  return s;
}

export interface Scope {
  /** The unit the user picked (or their own root). */
  rootId: number;
  label: string;
  options: Array<ScopeOption & { value: string }>;
  engineerIds: Set<number>;
  isWholeOrg: boolean;
  /** Trail of units from the top down to the picked unit. */
  trail: Array<{ id: number; label: string }>;
}

export function resolveScope(s: Session, scopeParam: string | undefined, forRole: Role = s.role): Scope {
  const { people } = s.world;
  const top = forRole === 'compliance' ? orgRoot(people)! : s.viewer.person;
  const allowed = s.viewer.scopeIds[forRole];
  const raw = Number(scopeParam);
  const picked = Number.isFinite(raw) && allowed.has(raw) && people.some((p) => p.id === raw) ? raw : top.id;
  const opts = scopeOptions(people, top.id).map((o) => ({ ...o, value: String(o.id), label: o.id === top.id && forRole === 'compliance' ? 'Whole org' : o.label }));
  const ids = subtreeIds(people, picked);
  const byId = new Map(people.map((p) => [p.id, p]));
  const trail: Scope['trail'] = [];
  for (let cur = byId.get(picked); cur; cur = cur.managerId ? byId.get(cur.managerId) : undefined) {
    trail.unshift({ id: cur.id, label: cur.id === top.id && forRole === 'compliance' ? 'Whole org' : cur.team ?? cur.name });
    if (cur.id === top.id) break;
  }
  return {
    rootId: picked, label: trail[trail.length - 1]?.label ?? 'Scope', options: opts, engineerIds: ids, isWholeOrg: picked === top.id && forRole === 'compliance', trail,
  };
}

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function resolveRange(now: Date, from?: string, to?: string): Range & { fromStr: string; toStr: string; label: string } {
  const parse = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : null);
  const end = parse(to) ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = parse(from) ?? new Date(end.getTime() - 27 * DAY);
  const [a, b] = start <= end ? [start, end] : [end, start];
  const toEnd = new Date(b.getTime() + DAY - 1);
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return { from: a, to: toEnd > now ? now : toEnd, fromStr: iso(a), toStr: iso(b), label: `${fmt(a)} – ${fmt(b)}` };
}

export interface PageFilters {
  scope: Scope;
  range: ReturnType<typeof resolveRange>;
  views: ItemView[];
  /** All items in scope, ignoring the date range (for "right now" views). */
  allViews: ItemView[];
}

export function applyFilters(s: Session, sp: Record<string, string | string[] | undefined>, forRole: Role = s.role): PageFilters {
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : (sp[k] as string | undefined));
  const scope = resolveScope(s, one('scope'), forRole);
  const range = resolveRange(s.world.now, one('from'), one('to'));
  const inScope = s.world.items.filter((i) => scope.engineerIds.has(i.engineerId));
  const allViews = toViews(inScope, s.world.people, s.world.files, s.world.now);
  return { scope, range, allViews, views: allViews.filter((v) => relevantInRange(v, range)) };
}

/** May this viewer see this engineer's items, in any role they hold? */
export function canSee(s: Session, engineerId: number): boolean {
  return s.viewer.roles.some((r) => s.viewer.scopeIds[r].has(engineerId));
}
export const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
