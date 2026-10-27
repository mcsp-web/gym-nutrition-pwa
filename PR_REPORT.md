# PR: FitCode Nutrition demo — front end, PWA, mock backend, Supabase files

**Branch:** `main` (initial commit `d6aa4b2`) · **Repo:** `fitcode-nutrition-demo` · **Status:** ready to deploy in mock mode; Supabase steps pending (needs a computer)

## Summary

Builds the full demo app from spec v2 so it can go live tonight without Supabase. A mock backend runs in the browser with seeded test users and enforces the same rules the database will (isolation, admin read-all, no self-promotion, 3 AI plans per day). Flipping one env var (`VITE_DATA_MODE=supabase`) switches to the real backend. The SQL migration, seed and Edge Function are written and ready to apply.

## What's in it

**App (Vite + vanilla JS, 22 KB JS gzipped 7.5 KB, excluding the lazily-loaded Supabase client)**
- Sign in, create account, reset password, set new password (live mode)
- **Today:** calories/protein/carbs/fat vs. target bars, 7-day protein average, daily weight + water check-in
- **Log:** meal entry by ounces or hand portions with macros; today's list with delete
- **Plan:** macro targets form, AI meal plan with "N of 3 left today" counter; button locks at the limit
- **Members (admin only):** read-only table with the same columns as `member_summary`
- **Account:** edit name, sign out, and two live **Security checks** — "read other members' meals" (members get 0 rows) and "make myself admin" (blocked)
- Footer on every page: "Demo built by MCSP Consulting for FitCode — not an official FitCode app."

**Look:** dark gym style using FitCode's own reds sampled from their site (CTA red #BC141C, highlight #E31B23), Roboto / Roboto Condensed. Plain text wordmark and an original "FN" icon — no FitCode logo or photos, per the spec's ground rules.

**PWA:** manifest, 192/512/maskable icons, Apple touch icon, service worker (app shell only, never caches API data), standalone display.

**Backend files (not yet applied)**
- `supabase/migrations/20261026000000_init.sql` — tables, Chicago-local `today_local()`, signup trigger, RLS on all member tables, role-column lock (table-wide UPDATE revoked, `full_name` re-granted), `claim_ai_call` (atomic per-member + global cap), `record_ai_tokens`, `current_streak`, `member_summary` (dashboard-only)
- `supabase/seed.sql` — test data + a check query (expect A streak 5, B streak 0)
- `supabase/functions/generate-meal-plan/index.ts` — verifies caller JWT, reads targets from DB (not the request), claims the cap, calls Claude with capped `max_tokens`, validates JSON, saves plan + tokens, CORS

**Deploy files:** `vercel.json` (SW cache headers), `Dockerfile` + `nginx.conf` (Coolify/VPS), `.env.example` (names only)

## Testing done

| Check | Result |
|---|---|
| `npm test` — 10 rule tests | ✅ 10/10 pass |
| Member A/B see only own meals; admin sees all | ✅ |
| `user_id` in payload is ignored (taken from session) | ✅ |
| Member can't promote self; non-admin can't read summary | ✅ (403) |
| 4th AI plan in a day | ✅ refused (429), other members unaffected |
| Cap resets at Chicago midnight, not UTC | ✅ |
| Summary math vs. seed (streak 5/0, last log 0/3 days, protein avg 60) | ✅ |
| `npm run build` | ✅ |
| Secret scan of `dist/` (`sk-ant`, `ANTHROPIC_API_KEY`, `service_role`) | ✅ clean |
| Visual check, 390 px phone viewport: login, today, log, plan at limit, account checks, admin members | ✅ |

**Not yet tested:** SQL against a real Supabase project, the Edge Function against Claude, install on a physical iPhone/Android, password-reset email.

## Decisions / notes for review

- **Mock mode is honest about itself:** a yellow banner says data stays in the browser. Don't present mock mode as the RLS proof — it shows the *flow*; the real proof is after `supabase db push`.
- Admin screen in live mode rebuilds the summary from tables the admin can read via RLS, because the view itself is intentionally not exposed to the API.
- Edge Function reads `ANTHROPIC_MODEL` from secrets with no hard-coded default — pick the current small Claude model when setting secrets.
- Failed Claude calls still count against the daily cap (documented).

## Next (needs a computer, ~1–2 hrs)

1. Create Supabase project → `supabase link` → `supabase db push`
2. Add 3 test users, run `seed.sql`, confirm the check query
3. Set secrets → `supabase functions deploy generate-meal-plan`
4. Set `VITE_DATA_MODE=supabase` + URL/anon key on the host, rebuild
5. Run the security checks as A, B and admin; record the 60–90 s video

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01Ncja3D5eY5T6HzsiMKcNda
