#!/usr/bin/env node
// RLS isolation test for public.notes — direct Supabase Auth + REST API calls.
// Zero dependencies (Node 18+). Uses ONLY the publishable key from ../config.js.
// Never prints access tokens. Never uses a secret / service_role key.
//
// Usage (from the my-notebook folder):
//   read -r  TEST_A_EMAIL;    read -rs TEST_A_PASSWORD; export TEST_A_EMAIL TEST_A_PASSWORD
//   read -r  TEST_B_EMAIL;    read -rs TEST_B_PASSWORD; export TEST_B_EMAIL TEST_B_PASSWORD
//   node tests/rls-test.mjs            # accounts must already exist and be confirmed
//   SIGNUP=1 node tests/rls-test.mjs   # try to sign the two accounts up first
//   KEEP=1 node tests/rls-test.mjs     # keep A's and B's test rows afterwards

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

// ---------- config (publishable key only) ----------
const cfgPath = fileURLToPath(new URL("../config.js", import.meta.url));
const sandbox = { window: {} };
vm.runInNewContext(readFileSync(cfgPath, "utf8"), sandbox);
const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY: KEY } = sandbox.window.NOTEBOOK_CONFIG || {};
const BASE = (SUPABASE_URL || "").replace(/\/$/, "");

if (!BASE || !KEY) die("config.js is missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY.");
if (!KEY.startsWith("sb_publishable_")) die("Refusing to run: config.js key is not a publishable key.");

const env = (k) => process.env[k] || die(`Missing env var ${k}.`);
const accounts = {
  A: { email: env("TEST_A_EMAIL"), password: env("TEST_A_PASSWORD") },
  B: { email: env("TEST_B_EMAIL"), password: env("TEST_B_PASSWORD") },
};
if (accounts.A.email.toLowerCase() === accounts.B.email.toLowerCase()) die("A and B must be different accounts.");

function die(msg) { console.error(`✖ ${msg}`); process.exit(2); }

// ---------- HTTP helpers ----------
// Errors are printed without headers, so tokens never reach the console.
async function call(method, path, { token, body, prefer } = {}) {
  const headers = { apikey: KEY, "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`; // user JWT only; logged-out sends apikey only
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body && JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, ok: res.ok, json };
}

async function signIn(who) {
  const { email, password } = accounts[who];
  const r = await call("POST", "/auth/v1/token?grant_type=password", { body: { email, password } });
  if (!r.ok) die(`Sign-in failed for ${who} (${email}): ${r.json?.error_description || r.json?.msg || r.status}`);
  return { token: r.json.access_token, id: r.json.user.id, email };
}

async function signUp(who) {
  const { email, password } = accounts[who];
  const r = await call("POST", "/auth/v1/signup", { body: { email, password } });
  if (!r.ok) console.log(`  · sign-up ${who}: ${r.json?.msg || r.json?.error_description || r.status} (continuing)`);
  else if (!r.json?.access_token) console.log(`  · sign-up ${who}: confirmation email sent — confirm it, then re-run without SIGNUP=1.`);
  else console.log(`  · sign-up ${who}: ok`);
}

const REP = "return=representation";
const notes = {
  list:   (s)          => call("GET",    "/rest/v1/notes?select=id,owner_id,body", { token: s?.token }),
  get:    (s, id)      => call("GET",    `/rest/v1/notes?select=id,owner_id,body&id=eq.${id}`, { token: s?.token }),
  insert: (s, row)     => call("POST",   "/rest/v1/notes?select=id,owner_id,body", { token: s?.token, body: row, prefer: REP }),
  update: (s, id, row) => call("PATCH",  `/rest/v1/notes?select=id,owner_id,body&id=eq.${id}`, { token: s?.token, body: row, prefer: REP }),
  remove: (s, id)      => call("DELETE", `/rest/v1/notes?select=id&id=eq.${id}`, { token: s?.token, prefer: REP }),
};

// ---------- assertions ----------
let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  ✔ ${name}`); }
  else { failed++; console.log(`  ✖ ${name}${detail ? `\n      → ${detail}` : ""}`); }
}
const summary = (r) => `HTTP ${r.status} ${JSON.stringify(r.json)?.slice(0, 200)}`;
const rows = (r) => (r.ok && Array.isArray(r.json) ? r.json : []);
const isDenied = (r) => !r.ok && (r.status === 401 || r.status === 403 || r.json?.code === "42501");
// "Blocked" = permission error OR success that touched zero rows.
const blocked = (r) => isDenied(r) || (r.ok && rows(r).length === 0);

// ---------- run ----------
const stamp = new Date().toISOString();
console.log(`RLS test against ${BASE}  (${stamp})\n`);

if (process.env.SIGNUP) {
  console.log("Sign-up");
  await signUp("A"); await signUp("B");
}

console.log("Sign-in");
const A = await signIn("A");
const B = await signIn("B");
check("A and B are different users", A.id !== B.id);

console.log("\n1. A manages A's rows");
const a1Body = `A original ${stamp}`;
let r = await notes.insert(A, { body: a1Body });            // owner_id from default auth.uid()
const A1 = rows(r)[0];
check("A inserts A1 (owner_id defaults to A)", A1 && A1.owner_id === A.id, summary(r));
r = await notes.insert(A, { body: `A scratch ${stamp}` });
const A2 = rows(r)[0];
check("A inserts A2", A2 && A2.owner_id === A.id, summary(r));
r = await notes.list(A);
check("A reads own rows", rows(r).some((n) => n.id === A1?.id) && rows(r).some((n) => n.id === A2?.id), summary(r));
r = await notes.update(A, A2?.id, { body: `A edited ${stamp}` });
check("A updates A2 (1 row)", rows(r).length === 1 && rows(r)[0].body === `A edited ${stamp}`, summary(r));
r = await notes.remove(A, A2?.id);
check("A deletes A2 (1 row)", rows(r).length === 1, summary(r));

console.log("\n2. B manages B's rows");
r = await notes.insert(B, { body: `B original ${stamp}` });
const B1 = rows(r)[0];
check("B inserts B1 (owner_id defaults to B)", B1 && B1.owner_id === B.id, summary(r));
r = await notes.insert(B, { body: `B scratch ${stamp}` });
const B2 = rows(r)[0];
check("B inserts B2", B2 && B2.owner_id === B.id, summary(r));
r = await notes.update(B, B2?.id, { body: `B edited ${stamp}` });
check("B updates B2 (1 row)", rows(r).length === 1, summary(r));
r = await notes.remove(B, B2?.id);
check("B deletes B2 (1 row)", rows(r).length === 1, summary(r));

if (!A1 || !B1) die("Setup rows missing — cannot run cross-user tests. See failures above.");

console.log("\n3. B attacks A's rows (cross-user)");
r = await notes.list(B);
check("B list: no rows owned by A leak", rows(r).every((n) => n.owner_id === B.id), summary(r));
r = await notes.get(B, A1.id);
check("B read A1 by id → 0 rows", blocked(r), summary(r));
r = await notes.update(B, A1.id, { body: "hacked by B" });
check("B update A1 body → 0 rows / denied", blocked(r), summary(r));
r = await notes.update(B, A1.id, { owner_id: B.id });
check("B steal A1 (set owner_id = B) → 0 rows / denied", blocked(r), summary(r));
r = await notes.remove(B, A1.id);
check("B delete A1 → 0 rows / denied", blocked(r), summary(r));
r = await notes.insert(B, { body: "forged by B", owner_id: A.id });
check("B insert with forged owner_id = A → denied", isDenied(r), summary(r));
if (r.ok) for (const n of rows(r)) await notes.remove(A, n.id); // clean up if it ever leaked
r = await notes.update(B, B1.id, { owner_id: A.id });
check("B give away B1 (set owner_id = A) → denied by WITH CHECK", blocked(r), summary(r));

console.log("\n4. A attacks B's rows (reverse direction)");
r = await notes.list(A);
check("A list: no rows owned by B leak", rows(r).every((n) => n.owner_id === A.id), summary(r));
r = await notes.update(A, B1.id, { body: "hacked by A" });
check("A update B1 → 0 rows / denied", blocked(r), summary(r));
r = await notes.remove(A, B1.id);
check("A delete B1 → 0 rows / denied", blocked(r), summary(r));
r = await notes.insert(A, { body: "forged by A", owner_id: B.id });
check("A insert with forged owner_id = B → denied", isDenied(r), summary(r));

console.log("\n5. Logged-out client (publishable key, no user token)");
r = await notes.list(null);
check("anon list → denied / 0 rows", blocked(r), summary(r));
r = await notes.get(null, A1.id);
check("anon read A1 → denied / 0 rows", blocked(r), summary(r));
r = await notes.insert(null, { body: "anon insert", owner_id: A.id });
check("anon insert → denied", isDenied(r), summary(r));
r = await notes.update(null, A1.id, { body: "hacked by anon" });
check("anon update A1 → denied / 0 rows", blocked(r), summary(r));
r = await notes.remove(null, A1.id);
check("anon delete A1 → denied / 0 rows", blocked(r), summary(r));

console.log("\n6. A verifies A1 is unchanged");
r = await notes.get(A, A1.id);
const after = rows(r)[0];
check("A1 still exists", !!after, summary(r));
check("A1 body unchanged", after?.body === a1Body, `expected "${a1Body}", got "${after?.body}"`);
check("A1 owner_id still A", after?.owner_id === A.id, `got ${after?.owner_id}`);
r = await notes.get(B, B1.id);
check("B1 owner_id still B", rows(r)[0]?.owner_id === B.id, summary(r));

if (!process.env.KEEP) {
  console.log("\nCleanup");
  r = await notes.remove(A, A1.id); check("A deletes A1", rows(r).length === 1, summary(r));
  r = await notes.remove(B, B1.id); check("B deletes B1", rows(r).length === 1, summary(r));
}

console.log(`\n${failed === 0 ? "PASS" : "FAIL"}: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
