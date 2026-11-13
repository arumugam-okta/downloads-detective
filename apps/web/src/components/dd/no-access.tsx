import { ShieldAlert } from 'lucide-react';

export function NoAccess({ message }: { message: string }) {
  return (
    <div className="grid min-h-screen place-items-center p-8">
      <div className="max-w-md rounded-xl border bg-card p-8 text-center">
        <ShieldAlert className="mx-auto size-8 text-muted-foreground" aria-hidden />
        <h1 className="mt-3 text-xl font-semibold">Downloads Detective</h1>
        <p className="mt-1 text-sm text-muted-foreground">{message}. Sign in through your organization and try again, or ask a compliance admin to add you.</p>
      </div>
    </div>
  );
}
