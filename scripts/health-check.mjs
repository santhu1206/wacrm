#!/usr/bin/env node
/**
 * Production health check: env, schema depth, API smoke tests, pages.
 * Run: npm run health:check  (requires dev server on :3000 for route tests)
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
    /* */
  }
}

loadEnvLocal();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
const service = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const base = process.env.HEALTH_BASE_URL?.trim() || "http://localhost:3000";

const report = {
  env: [],
  schema: [],
  rpc: [],
  columns: [],
  pages: [],
  api: [],
  tests: null,
};

function line(section, status, msg) {
  section.push({ status, msg });
}

// --- Env ---
const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ENCRYPTION_KEY",
  "META_APP_SECRET",
];
for (const k of required) {
  const v = process.env[k]?.trim();
  if (!v) line(report.env, "fail", `${k} missing`);
  else if (k === "ENCRYPTION_KEY" && !/^[0-9a-f]{64}$/.test(v))
    line(report.env, "fail", `${k} invalid (need 64 hex chars)`);
  else line(report.env, "ok", k);
}
if (!process.env.NEXT_PUBLIC_SITE_URL?.trim())
  line(report.env, "warn", "NEXT_PUBLIC_SITE_URL unset (defaults exist in app)");
else line(report.env, "ok", "NEXT_PUBLIC_SITE_URL");

if (!process.env.AUTOMATION_CRON_SECRET?.trim())
  line(report.env, "warn", "AUTOMATION_CRON_SECRET unset (Wait-step automations need cron)");

const headers = { apikey: service || anon, Authorization: `Bearer ${service || anon}` };

async function rest(path) {
  return fetch(`${url}/rest/v1/${path}`, { headers });
}

async function rpc(name, body = {}) {
  return fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
}

// --- Schema columns spot-check ---
const columnChecks = [
  { table: "profiles", col: "beta_features", migration: "011" },
  { table: "deals", col: "assigned_to", migration: "002" },
  { table: "broadcast_recipients", col: "whatsapp_message_id", migration: "003" },
  { table: "message_templates", col: "meta_template_id", migration: "014" },
  { table: "message_templates", col: "sample_values", migration: "014" },
];

if (url) {
  for (const { table, col, migration } of columnChecks) {
    try {
      const res = await rest(`${table}?select=${col}&limit=0`);
      if (res.ok) line(report.columns, "ok", `${table}.${col} (${migration})`);
      else {
        const b = await res.json().catch(() => ({}));
        line(report.columns, "fail", `${table}.${col}: ${b.message || res.status}`);
      }
    } catch (e) {
      line(report.columns, "fail", `${table}.${col}: ${e.message}`);
    }
  }

  for (const { name, fakeId } of rpcChecks) {
    try {
      const res = await rpc(name, name.includes("automation") ? { p_automation_id: fakeId } : { p_flow_id: fakeId });
      if (res.status === 204 || res.ok) line(report.rpc, "ok", `rpc/${name} callable`);
      else if (res.status === 404) line(report.rpc, "fail", `rpc/${name} missing — run migration 007/012`);
      else line(report.rpc, "ok", `rpc/${name} exists (HTTP ${res.status}, no row updated is OK)`);
    } catch (e) {
      line(report.rpc, "fail", `rpc/${name}: ${e.message}`);
    }
  }
} else {
  line(report.columns, "warn", "NEXT_PUBLIC_SUPABASE_URL missing, skipping direct REST checks");
  line(report.rpc, "warn", "NEXT_PUBLIC_SUPABASE_URL missing, skipping direct RPC checks");
}

// --- Pages (no auth) ---
const pages = [
  "/",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/dashboard",
  "/pipelines",
  "/inbox",
  "/contacts",
  "/flows",
  "/automations",
  "/broadcasts",
  "/settings",
];
for (const p of pages) {
  try {
    const res = await fetch(`${base}${p}`, { redirect: "manual" });
    const ok = res.status === 200 || res.status === 307 || res.status === 308;
    line(report.pages, ok ? "ok" : "fail", `GET ${p} → ${res.status}`);
  } catch (e) {
    line(report.pages, "fail", `GET ${p} → ${e.message}`);
  }
}

// --- API smoke (expect 401 without session unless noted) ---
const apiRoutes = [
  { path: "/api/auth/signup", method: "POST", expect: [400, 401, 429], body: {} },
  { path: "/api/whatsapp/config", method: "GET", expect: [401] },
  { path: "/api/whatsapp/webhook", method: "GET", expect: [200, 403], note: "verify challenge" },
  { path: "/api/automations", method: "GET", expect: [401] },
  { path: "/api/flows", method: "GET", expect: [401] },
  {
    path: "/api/automations/cron",
    method: "GET",
    expect: process.env.AUTOMATION_CRON_SECRET ? [401] : [503],
  },
  {
    path: "/api/flows/cron",
    method: "GET",
    expect: process.env.AUTOMATION_CRON_SECRET ? [401] : [503],
  },
  { path: "/auth/callback", method: "GET", expect: [307, 308] },
];

for (const r of apiRoutes) {
  try {
    const init = {
      method: r.method,
      redirect: "manual",
      headers: r.body !== undefined ? { "Content-Type": "application/json" } : {},
      body: r.body !== undefined ? JSON.stringify(r.body) : undefined,
    };
    const res = await fetch(`${base}${r.path}`, init);
    const pass = r.expect.includes(res.status);
    line(
      report.api,
      pass ? "ok" : "warn",
      `${r.method} ${r.path} → ${res.status}${r.note ? ` (${r.note})` : ""}`,
    );
  } catch (e) {
    line(report.api, "fail", `${r.method} ${r.path} → ${e.message}`);
  }
}

// --- Print ---
console.log("\n========== WACRM HEALTH CHECK ==========\n");

function printSection(title, items) {
  console.log(`--- ${title} ---`);
  for (const { status, msg } of items) {
    const icon = status === "ok" ? "✅" : status === "warn" ? "⚠️" : "❌";
    console.log(`${icon} ${msg}`);
  }
  console.log();
}

printSection("Environment", report.env);
printSection("Schema columns (migration spot-check)", report.columns);
printSection("RPC functions", report.rpc);
printSection("Pages", report.pages);
printSection("API routes", report.api);

const fails =
  [...report.env, ...report.columns, ...report.rpc, ...report.pages, ...report.api].filter(
    (x) => x.status === "fail",
  ).length;
const warns = [...report.env, ...report.api].filter((x) => x.status === "warn").length;

console.log(`Summary: ${fails} failures, ${warns} warnings`);
process.exit(fails > 0 ? 1 : 0);
