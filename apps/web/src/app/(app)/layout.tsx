import { Suspense } from 'react';
import { Shell } from '@/components/dd/shell';
import { getSession, resolveRange, resolveScope, ROLE_LABEL } from '@/lib/session';
import { orgRoot, highestRole } from '@dd/shared';

// Every page reads the signed-in user, so none of this can be prerendered.
export const dynamic = 'force-dynamic';

async function ShellLoader({ children }: { children: React.ReactNode }) {
  const s = await getSession();
  const scope = resolveScope(s, undefined);
  const range = resolveRange(s.world.now);
  const { people, items } = s.world;
  const visible = new Set(s.viewer.scopeIds[s.role]);
  const byId = new Map(people.map((p) => [p.id, p]));

  const searchIndex = [
    ...items.filter((i) => visible.has(i.engineerId)).slice(-400).reverse().map((i) => ({
      kind: 'case' as const, label: `Case #${i.caseNumber} · ${byId.get(i.engineerId)?.name ?? ''}`, hint: i.ref, href: `/items/${i.id}`,
    })),
    ...(s.role === 'engineer' ? [] : people.filter((p) => visible.has(p.id) && p.id !== s.viewer.person.id).map((p) => ({
      kind: 'person' as const, label: `${p.name} · ${p.team ?? 'Engineer'}`, hint: p.email, href: `/people/${p.id}`,
    }))),
  ];

  const dev = process.env.NODE_ENV !== 'production' && process.env.DEV_AUTH !== 'off';
  const root = orgRoot(people);
  const devUsers = dev
    ? people.filter((p) => p.active && (p.isCompliance || p.id === root?.id || ['Elena Brooks', 'Maya Patel', 'Daniel Ruiz', 'Marcus Reed', 'Ben Foster'].includes(p.name)))
        .map((p) => ({ email: p.email, name: p.name, role: ROLE_LABEL[highestRole({ ...s.viewer, roles: p.isCompliance ? ['compliance'] : people.some((x) => x.managerId === p.id) ? ['manager'] : ['engineer'] })] }))
    : null;

  return (
    <Shell
      role={s.role}
      roles={s.viewer.roles}
      user={{ name: s.viewer.person.name, email: s.viewer.person.email }}
      scope={{
        value: String(scope.rootId), label: scope.label, trail: scope.trail, show: s.role !== 'engineer' && scope.options.length > 1,
        options: scope.options.map((o) => ({ value: o.value, label: o.label, depth: o.depth })),
      }}
      range={{ from: range.fromStr, to: range.toStr, label: range.label }}
      workspaceLabel={`${ROLE_LABEL[s.role]} workspace`}
      devUsers={devUsers}
      searchIndex={searchIndex}
    >
      {children}
    </Shell>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Loading…</div>}>
      <ShellLoader>{children}</ShellLoader>
    </Suspense>
  );
}
