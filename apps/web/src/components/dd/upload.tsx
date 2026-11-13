'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { uploadReport } from '@/lib/actions';

export function UploadReport() {
  const ref = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState('');
  return (
    <form
      className="flex items-center gap-2"
      action={(fd) => start(async () => {
        const r = await uploadReport(fd);
        if (!r.ok) { toast.error(r.error ?? 'Upload failed'); return; }
        const d = r.data as { itemsCreated: number; duplicateRows: number; invalidRows: number };
        toast.success(`Imported: ${d.itemsCreated} new item${d.itemsCreated === 1 ? '' : 's'}, ${d.duplicateRows} duplicate${d.duplicateRows === 1 ? '' : 's'}${d.invalidRows ? `, ${d.invalidRows} invalid` : ''}`);
        setName(''); if (ref.current) ref.current.value = ''; router.refresh();
      })}
    >
      <input ref={ref} type="file" name="file" accept=".csv,text/csv" className="sr-only" id="report-file" onChange={(e) => setName(e.target.files?.[0]?.name ?? '')} />
      <Button type="button" variant="outline" onClick={() => ref.current?.click()}><Upload className="size-4" />{name || 'Choose CSV'}</Button>
      <Button type="submit" disabled={!name || pending}>{pending ? 'Importing…' : 'Import report'}</Button>
    </form>
  );
}
