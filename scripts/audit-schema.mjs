#!/usr/bin/env node
/**
 * Compares required wacrm schema vs live Supabase project.
 * Run: npm run audit:schema
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATIONS = readdirSync(resolve(process.cwd(), "supabase/migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort();

/** Tables the app queries via supabase.from(...) */
const REQUIRED_TABLES = [
  { table: "profiles", migration: "001", module: "Auth, settings, inbox" },
  { table: "contacts", migration: "001", module: "Contacts, inbox, broadcasts" },
  { table: "tags", migration: "001", module: "Contacts" },
  { table: "contact_tags", migration: "001", module: "Contacts, broadcasts" },
  { table: "custom_fields", migration: "001", module: "Contacts, broadcasts" },
  { table: "contact_custom_values", migration: "001", module: "Contacts, broadcasts" },
  { table: "contact_notes", migration: "001", module: "Inbox sidebar" },
  { table: "conversations", migration: "001", module: "Inbox" },
  { table: "messages", migration: "001", module: "Inbox, webhooks" },
  { table: "whatsapp_config", migration: "001", module: "Settings, WhatsApp API" },
  { table: "message_templates", migration: "001+014", module: "Broadcasts, templates" },
  { table: "pipelines", migration: "001", module: "Pipelines" },
  { table: "pipeline_stages", migration: "001", module: "Pipelines" },
  { table: "deals", migration: "001+002", module: "Pipelines, inbox" },
  { table: "broadcasts", migration: "001", module: "Broadcasts" },
  { table: "broadcast_recipients", migration: "001+003", module: "Broadcasts, webhooks" },
  { table: "automations", migration: "006", module: "Automations" },
  { table: "automation_steps", migration: "006", module: "Automations" },
  { table: "automation_logs", migration: "006", module: "Automations" },
  { table: "automation_pending_executions", migration: "006", module: "Automations cron" },
  { table: "message_reactions", migration: "009", module: "Inbox reactions" },
  { table: "flows", migration: "010", module: "Flows" },
  { table: "flow_nodes", migration: "010", module: "Flows" },
  { table: "flow_runs", migration: "010", module: "Flows" },
  { table: "flow_run_events", migration: "010", module: "Flows" },
  { table: "accounts", migration: "017", module: "Multi-user accounts & sharing" },
  { table: "account_invitations", migration: "017", module: "Team invitations" },
  { table: "member_presence", migration: "024", module: "Agent presence tracking" },
  { table: "api_keys", migration: "026", module: "Public REST API keys" },
  { table: "notifications", migration: "027", module: "In-app & browser notifications" },
  { table: "webhook_endpoints", migration: "028", module: "Outbound webhooks" },
  { table: "ai_configs", migration: "029", module: "AI assistant settings" },
  { table: "ai_knowledge_documents", migration: "030", module: "AI knowledge base" },
  { table: "ai_knowledge_chunks", migration: "030", module: "AI semantic / full-text chunks" },
  { table: "ai_usage_log", migration: "033", module: "AI token spend tracking" },
  { table: "quick_replies", migration: "035", module: "Interactive quick replies" },
  { table: "pending_message_statuses", migration: "054", module: "Webhook delivery order buffer" },
];

const STORAGE_BUCKETS = [
  { bucket: "avatars", migration: "008", module: "Profile avatars" },
  { bucket: "flow-media", migration: "016", module: "Flow media attachments" },
  { bucket: "chat-media", migration: "023", module: "Inbound chat media mirror" },
];

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
    /* optional */
  }
}

loadEnvLocal();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const headers = { apikey: key, Authorization: `Bearer ${key}` };

async function tableExists(table) {
  const res = await fetch(`${url}/rest/v1/${table}?select=id&limit=1`, { headers });
  if (res.ok) return true;
  const body = await res.json().catch(() => ({}));
  if (res.status === 404 && body?.code === "PGRST205") return false;
  return { error: `HTTP ${res.status}: ${JSON.stringify(body)}` };
}

async function bucketExists(bucket) {
  const res = await fetch(`${url}/storage/v1/bucket/${bucket}`, { headers });
  return res.ok;
}

async function main() {
  console.log("=== wacrm schema audit ===\n");
  console.log(`Project: ${url}\n`);

  const present = [];
  const missing = [];
  const errors = [];

  for (const { table, migration, module } of REQUIRED_TABLES) {
    const result = await tableExists(table);
    if (result === true) present.push({ table, migration, module });
    else if (result === false) missing.push({ table, migration, module });
    else errors.push({ table, ...result });
  }

  console.log(`Tables present: ${present.length}/${REQUIRED_TABLES.length}`);
  if (present.length) {
    for (const r of present) console.log(`  ✓ ${r.table} (migration ${r.migration})`);
  }

  console.log(`\nTables MISSING: ${missing.length}/${REQUIRED_TABLES.length}`);
  for (const r of missing) {
    console.log(`  ✗ ${r.table} — needs migration ${r.migration} — ${r.module}`);
  }

  if (errors.length) {
    console.log("\nProbe errors:");
    for (const e of errors) console.log(`  ? ${e.table}: ${e.error}`);
  }

  console.log("\n--- Storage ---");
  for (const { bucket, migration, module } of STORAGE_BUCKETS) {
    const ok = await bucketExists(bucket);
    console.log(`  ${ok ? "✓" : "✗"} bucket "${bucket}" (migration ${migration}) — ${module}`);
    if (!ok) missing.push({ table: `storage:${bucket}`, migration, module });
  }

  const migrationDir = resolve(process.cwd(), "supabase/migrations");
  const onDisk = readdirSync(migrationDir).filter((f) => f.endsWith(".sql")).sort();
  const allMigrationsPath = resolve(process.cwd(), "supabase/ALL_MIGRATIONS.sql");
  let combinedExists = false;
  try {
    readFileSync(allMigrationsPath);
    combinedExists = true;
  } catch {
    /* */
  }

  console.log("\n--- Migration files (apply in order) ---");
  for (const file of MIGRATIONS) {
    const found = onDisk.includes(file);
    const appliedGuess = present.some((p) => {
      const m = REQUIRED_TABLES.find((t) => t.table === p.table);
      return m?.migration.startsWith(file.slice(0, 3));
    });
    console.log(
      `  ${found ? "○" : "?"} ${file}${found ? "" : " (missing on disk)"}`,
    );
  }

  console.log("\n--- Fix ---");
  if (missing.length) {
    console.log("None of the schema appears fully applied.");
    console.log("Run this file once in Supabase SQL Editor:");
    console.log(`  ${allMigrationsPath}`);
    if (combinedExists) {
      console.log("\nOr run each file under supabase/migrations/ in numeric order.");
    }
    console.log(
      "\nDashboard: https://supabase.com/dashboard/project/bnzpvrumdihhmkpqspcn/sql/new",
    );
    process.exit(1);
  }

  console.log("All required tables and storage buckets exist.");
  console.log("\nRun deep checks: npm run health:check");
  console.log("Re-run table audit: npm run audit:schema");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
