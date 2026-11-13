import type { OrgNode } from './metrics';

import type { TreeRow } from '@/components/dd/org-tree';

export function toRows(root: OrgNode, hrefFor: (n: OrgNode) => string): TreeRow[] {
  const out: TreeRow[] = [];
  const walk = (n: OrgNode, parent: number | null) => {
    out.push({
      id: n.person.id, label: n.label, subtitle: n.subtitle, depth: n.depth, open: n.rollup.notClosed, overdue: n.rollup.overdue, closed: n.rollup.closed,
      sla: n.rollup.slaPct, hasChildren: n.children.length > 0, href: hrefFor(n), parentId: parent,
    });
    n.children.forEach((c) => walk(c, n.person.id));
  };
  walk(root, null);
  return out;
}
