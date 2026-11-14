import { Suspense } from 'react';
import { Shell } from '@/components/dd/shell';
import { getSession, NoAccessError, resolveRange, resolveScope, ROLE_LABEL } from '@/lib/session';
import { NoAccess } from '@/components/dd/no-access';

// Every page reads the signed-in user, so none of this can be prerendered.
export const dynamic = 'force-dynamic';

async function ShellLoader({ children }: { children: React.ReactNode }) {
  let s: Awaited<ReturnType<typeof getSession>>;
  try {
    s = await getSession();
  } catch (e) {
    if (e instanceof NoAccessError) return <NoAccess message={e.message} />;
    throw e;
  }
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
      workspaceName={process.env.WORKSPACE_NAME?.trim() || 'Okta engineering'}
      workspaceLabel={`${ROLE_LABEL[s.role]} workspace`}
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
