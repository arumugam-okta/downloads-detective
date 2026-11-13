'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ListFilter } from 'lucide-react';

export interface FilterField {
  key: string;
  label: string;
  options: Array<{ value: string; label: string }>;
}

/** One row, above the content, scoping everything beneath it. State lives in the URL. */
export function Filters({ fields }: { fields: FilterField[] }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp.toString());
    if (v) n.set(k, v); else n.delete(k);
    n.delete('page');
    router.push(`${path}?${n.toString()}`);
  };
  const active = fields.some((f) => sp.get(f.key));
  return (
    <div className="flex items-center gap-6 rounded-xl border bg-card px-4 py-2.5 text-sm" role="search" aria-label="Filters">
      <span className="flex items-center gap-2 font-medium"><ListFilter className="size-4" aria-hidden />Filters</span>
      {fields.map((f) => (
        <select key={f.key} aria-label={f.label} value={sp.get(f.key) ?? ''} onChange={(e) => set(f.key, e.target.value)} className="h-8 rounded-md bg-transparent pr-2 outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <option value="">{f.label}</option>
          {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ))}
      <button type="button" disabled={!active} onClick={() => { const n = new URLSearchParams(sp.toString()); fields.forEach((f) => n.delete(f.key)); router.push(`${path}?${n.toString()}`); }} className="ml-auto text-muted-foreground enabled:hover:underline disabled:opacity-40">
        Clear filters
      </button>
    </div>
  );
}
