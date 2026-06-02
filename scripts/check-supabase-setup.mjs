#!/usr/bin/env node
/**
 * Verifies Supabase env vars and that core schema (profiles) exists.
 * Run: node scripts/check-supabase-setup.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvLocal() {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // .env.local optional when vars are already exported
  }
}

loadEnvLocal();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

let failed = false;

function fail(msg) {
  console.error("✗", msg);
  failed = true;
}

function ok(msg) {
  console.log("✓", msg);
}

if (!url) fail("NEXT_PUBLIC_SUPABASE_URL is missing");
else ok(`NEXT_PUBLIC_SUPABASE_URL = ${url}`);

if (!anon) fail("NEXT_PUBLIC_SUPABASE_ANON_KEY is missing");
else ok(`NEXT_PUBLIC_SUPABASE_ANON_KEY is set (${anon.length} chars)`);

if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
  fail("SUPABASE_SERVICE_ROLE_KEY is missing");
} else {
  ok("SUPABASE_SERVICE_ROLE_KEY is set");
}

if (!process.env.ENCRYPTION_KEY?.trim()) {
  fail("ENCRYPTION_KEY is missing");
} else if (!/^[0-9a-f]{64}$/.test(process.env.ENCRYPTION_KEY.trim())) {
  fail("ENCRYPTION_KEY must be exactly 64 lowercase hex characters");
} else {
  ok("ENCRYPTION_KEY format is valid");
}

if (!url || !anon) {
  process.exit(1);
}

const headers = { apikey: anon, Authorization: `Bearer ${anon}` };

try {
  const res = await fetch(`${url}/rest/v1/profiles?select=id&limit=1`, { headers });
  if (res.status === 404) {
    const body = await res.json().catch(() => ({}));
    if (body?.code === "PGRST205") {
      fail(
        'Table "profiles" not found — run supabase/ALL_MIGRATIONS.sql in the Supabase SQL Editor',
      );
    } else {
      fail(`profiles check failed: HTTP ${res.status}`);
    }
  } else if (!res.ok) {
    fail(`profiles check failed: HTTP ${res.status} ${await res.text()}`);
  } else {
    ok('Table "profiles" exists');
  }
} catch (err) {
  fail(`Cannot reach Supabase REST API: ${err.message}`);
}

try {
  const res = await fetch(`${url}/auth/v1/health`, { headers });
  if (res.ok) ok("Auth API is reachable");
  else fail(`Auth health check: HTTP ${res.status}`);
} catch (err) {
  fail(`Cannot reach Supabase Auth API: ${err.message}`);
}

if (failed) {
  console.log("\nFix migrations: https://supabase.com/dashboard/project/bnzpvrumdihhmkpqspcn/sql/new");
  console.log("Paste and run: supabase/ALL_MIGRATIONS.sql");
  process.exit(1);
}

console.log("\nSupabase setup looks good.");
