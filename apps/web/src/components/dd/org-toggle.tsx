'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

export function OrgToggle({ value }: { value: 'tree' | 'flat' }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  return (
    <ToggleGroup type="single" value={value} variant="outline" onValueChange={(v) => { if (!v) return; const n = new URLSearchParams(sp.toString()); n.set('view', v); router.push(`${path}?${n}`); }} aria-label="Org view">
      <ToggleGroupItem value="tree">Org tree</ToggleGroupItem>
      <ToggleGroupItem value="flat">Flat teams</ToggleGroupItem>
    </ToggleGroup>
  );
}
