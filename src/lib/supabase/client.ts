import { createBrowserClient } from '@supabase/ssr'

// Use the @supabase/ssr module singleton (isSingleton defaults to true in
// the browser). A second manual singleton here caused duplicate clients and
// intermittent "Failed to fetch" / auth-lock errors.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key',
    { isSingleton: true },
  )
}
