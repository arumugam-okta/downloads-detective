'use client';

import { ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const noAccess = /not signed in|not in the Downloads Detective|needs .* access/i.test(error.message);
  return (
    <div className="grid min-h-screen place-items-center p-8">
      <div className="max-w-md rounded-xl border bg-card p-8 text-center">
        <ShieldAlert className="mx-auto size-8 text-muted-foreground" />
        <h1 className="mt-3 text-xl font-semibold">{noAccess ? 'You don’t have access to this page' : 'Something went wrong'}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{noAccess ? error.message : 'We could not load this page. Try again in a moment.'}</p>
        <div className="mt-5 flex justify-center gap-2">
          <Button variant="outline" onClick={reset}>Try again</Button>
          <Button asChild><a href="/">Go home</a></Button>
        </div>
      </div>
    </div>
  );
}
