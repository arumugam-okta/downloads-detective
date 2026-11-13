import { SupabaseStore } from './supabase.ts';
import type { Store } from './store.ts';

/**
 * IDDB_API_URL    injected by OAP: the API base URL (supabase-js appends /rest/v1)
 * IDDB_ANON_KEY   injected by OAP: the anon key. RLS decides what it can read or write.
 * DB_SCHEMA       optional: schema holding the dd_* tables (default: public). IDDB_* names are reserved by the
 *                 platform, so anything we set ourselves has to use another prefix.
 */
export function createStore(env: NodeJS.ProcessEnv = process.env): Store {
  const url = env.IDDB_API_URL;
  const key = env.IDDB_ANON_KEY;
  if (!url || !key) {
    throw new Error('Database is not configured: IDDB_API_URL and IDDB_ANON_KEY are not set. OAP injects both into hosted apps.');
  }
  return new SupabaseStore({ url, key, ...(env.DB_SCHEMA ? { schema: env.DB_SCHEMA } : {}) });
}
