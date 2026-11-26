# RLS test checklist — public.notes

Rules: two dummy accounts (A, B) + a logged-out client. Publishable key only.
No secret/service_role key. Never paste or print access tokens.

**Pass** = no leaked rows, and every cross-user or anonymous write either
affects **0 rows** or returns a **permission error** (HTTP 401/403, code `42501`).

## 0. Prerequisites
- [ ] `setup.sql` reviewed and run in the SQL Editor
- [ ] `pg_policies` shows 4 policies on `notes`, all for `{authenticated}`
- [ ] `role_table_grants`: `authenticated` has only SELECT/INSERT/UPDATE/DELETE; no `anon` row
- [ ] Two dummy accounts with throwaway emails (e.g. `you+a@…`, `you+b@…`), both confirmed
- [ ] `config.js` holds `sb_publishable_…` (never `sb_secret_…`)

## 1. Automated API tests: `node tests/rls-test.mjs`
| # | Actor | Action | Expected |
|---|---|---|---|
| 1.1 | A | insert A1, A2 (no owner_id sent) | 1 row each, `owner_id = A` |
| 1.2 | A | read own rows | A1, A2 returned |
| 1.3 | A | update A2, delete A2 | 1 row affected each |
| 2.1 | B | insert B1, B2; update + delete B2 | 1 row each, `owner_id = B` |
| 3.1 | B | list all notes | only B's rows, none of A's |
| 3.2 | B | read A1 by id | 0 rows |
| 3.3 | B | update A1 body | 0 rows / denied |
| 3.4 | B | update A1 `owner_id = B` (steal) | 0 rows / denied |
| 3.5 | B | delete A1 | 0 rows / denied |
| 3.6 | B | insert with `owner_id = A` (forged) | **denied** (42501) |
| 3.7 | B | update own B1 `owner_id = A` (give away) | **denied** (WITH CHECK) |
| 4.1–4.4 | A | same attacks against B1 | no leak, 0 rows / denied |
| 5.1–5.5 | logged-out | list, read, insert, update, delete | denied / 0 rows |
| 6.1 | A | re-read A1 | exists, body and owner_id **unchanged** |
| 6.2 | B | re-read B1 | owner_id still B |

- [ ] Script ends with `PASS: N passed, 0 failed` (exit code 0)
- [ ] No token appears anywhere in the output

## 2. Manual UI checks: two browsers, or a normal and a private window
- [ ] A signs in → status line shows "Signed in as A"
- [ ] A creates, edits and deletes a note; reloading keeps the session and the notes
- [ ] Note `<img src=x onerror=alert(1)>` is shown as plain text, with no alert
- [ ] B signs in in the other window → none of A's notes visible
- [ ] A signs out → status shows "Signed out", list cleared
- [ ] Empty note / wrong password / network off → red error box

## 3. Dashboard cross-check (optional)
- [ ] Table Editor → `notes`: each row's `owner_id` matches its author in Authentication → Users
- [ ] After the script without `KEEP=1`, no `A original …` / `B original …` rows remain

## If something fails
- B sees A's rows → SELECT policy missing or RLS disabled (`alter table … enable row level security`)
- Forged insert succeeds → INSERT policy lacks `with check`, or a broad policy (`using (true)`) exists
- Give-away succeeds → UPDATE policy lacks `with check`
- Logged-out read returns rows → an `anon` grant or a `to public` policy exists
- `relation "public.notes" does not exist` → `setup.sql` not run yet
