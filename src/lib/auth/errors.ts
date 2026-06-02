import type { AuthError } from "@supabase/supabase-js";

/** Map Supabase auth errors to user-facing copy. */
export function formatAuthError(error: AuthError | Error): string {
  if ("status" in error && error.status === 429) {
    return "Too many signup attempts. Wait a few minutes and try again.";
  }
  if ("status" in error && error.status === 504) {
    return "Signup timed out while sending the confirmation email. Disable “Confirm email” in Supabase (Authentication → Providers → Email) for local dev, or fix your SMTP settings.";
  }
  if (error.message === "Failed to fetch" || error.name === "AuthRetryableFetchError") {
    return "Could not reach Supabase. Check your internet connection, disable ad blockers for this site, and confirm NEXT_PUBLIC_SUPABASE_URL in .env.local is correct.";
  }
  if ("status" in error && error.status === 400 && error.message.includes("invalid")) {
    return error.message;
  }
  return error.message;
}
