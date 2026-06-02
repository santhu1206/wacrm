import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { formatAuthError } from "@/lib/auth/errors";

function getSupabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
}

function getSupabaseAnonKey() {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
}

export async function POST(request: Request) {
  const url = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();

  if (!url || !anonKey) {
    return NextResponse.json(
      {
        error:
          "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local, then restart the dev server.",
      },
      { status: 500 },
    );
  }

  const body = await request.json().catch(() => null);
  if (!body?.email || !body?.password) {
    return NextResponse.json(
      { error: "Email and password are required." },
      { status: 400 },
    );
  }

  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    request.headers.get("origin") ||
    "http://localhost:3000";

  const supabase = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data, error } = await supabase.auth.signUp({
    email: body.email,
    password: body.password,
    options: {
      data: {
        full_name: body.full_name ?? body.fullName ?? "",
      },
      emailRedirectTo: `${origin}/auth/callback`,
    },
  });

  if (error) {
    return NextResponse.json(
      { error: formatAuthError(error) },
      { status: error.status ?? 400 },
    );
  }

  return NextResponse.json({
    user: data.user,
    session: data.session,
  });
}
