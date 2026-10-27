// Supabase Edge Function: generate-meal-plan
// Deploy: supabase functions deploy generate-meal-plan
// Secrets: supabase secrets set ANTHROPIC_API_KEY=... ANTHROPIC_MODEL=... \
//          AI_DAILY_LIMIT_PER_MEMBER=3 AI_DAILY_LIMIT_GLOBAL=100 ALLOWED_ORIGIN=https://your-demo-domain
//
// The Anthropic key lives only here. The browser never sees it.
import { createClient } from 'npm:@supabase/supabase-js@2';

const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? '*';
const MEMBER_LIMIT = Number(Deno.env.get('AI_DAILY_LIMIT_PER_MEMBER') ?? 3);
const GLOBAL_LIMIT = Number(Deno.env.get('AI_DAILY_LIMIT_GLOBAL') ?? 100);
const MODEL = Deno.env.get('ANTHROPIC_MODEL');
const API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
// Covers adaptive thinking + a full day's JSON plan. At Haiku pricing this is a fraction of a cent per plan.
const MAX_TOKENS = 3000;

const cors = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin'
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const SYSTEM = `You are a sports nutrition assistant for a strength and conditioning gym.
Write ONE day of eating that hits the member's macro targets as closely as practical.
Use common grocery foods. Give amounts in ounces or hand portions (palm = protein, fist = vegetables,
cupped hand = carbs, thumb = fats). Respect the member's preferences and any foods they avoid.
Do not give medical advice. If a preference asks for something unsafe, ignore that part.
Reply with JSON only, no prose, matching exactly:
{"meals":[{"name":"Breakfast|Lunch|Dinner|Snacks","items":[{"food":string,"amount":string,"protein_g":number,"carbs_g":number,"fat_g":number}]}],
 "totals":{"calories":number,"protein_g":number,"carbs_g":number,"fat_g":number},
 "notes":string}`;

function validPlan(p: any): boolean {
  return p && Array.isArray(p.meals) && p.meals.length >= 3 && p.meals.length <= 6 &&
    p.meals.every((m: any) => typeof m.name === 'string' && Array.isArray(m.items) &&
      m.items.every((i: any) => typeof i.food === 'string' && typeof i.amount === 'string' &&
        ['protein_g', 'carbs_g', 'fat_g'].every((k) => Number.isFinite(Number(i[k])))));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (!API_KEY || !MODEL) return json({ error: 'AI is not configured yet.' }, 503);

  // 1. Caller must be signed in. Use THEIR token so auth.uid() and RLS apply to every query below.
  const authHeader = req.headers.get('Authorization') ?? '';
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } }
  });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: 'Please sign in.' }, 401);

  // 2. Validate input.
  let body: { preferences?: unknown } = {};
  try { body = await req.json(); } catch { /* empty body is fine */ }
  const preferences = typeof body.preferences === 'string' ? body.preferences.trim() : '';
  if (preferences.length > 500) return json({ error: 'Keep preferences under 500 characters.' }, 400);

  // Targets come from the database, not the request, so they can't be spoofed.
  const { data: target, error: tErr } = await supabase.from('macro_plans')
    .select('calories, protein_g, carbs_g, fat_g').eq('user_id', user.id)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (tErr) return json({ error: 'Could not load your targets.' }, 500);
  if (!target) return json({ error: 'Save your macro targets first.' }, 400);

  // 3. Claim one call against today's per-member and global caps (atomic, in Postgres).
  const { data: ok, error: cErr } = await supabase.rpc('claim_ai_call', {
    member_limit: MEMBER_LIMIT, global_limit: GLOBAL_LIMIT
  });
  if (cErr) return json({ error: 'Usage check failed.' }, 500);
  if (!ok) return json({ error: `You've used today's ${MEMBER_LIMIT} meal plans. New ones tomorrow.` }, 429);

  // 4. Call Claude.
  const userMsg = `Targets: ${target.calories} kcal, ${target.protein_g} g protein, ${target.carbs_g} g carbs, ${target.fat_g} g fat.
Preferences: ${preferences || 'none'}`;
  let res: Response;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, system: SYSTEM, messages: [{ role: 'user', content: userMsg }] })
    });
  } catch {
    return json({ error: 'The meal planner is unreachable. Try again in a minute.' }, 502);
  }
  if (!res.ok) {
    console.error('anthropic error', res.status, await res.text());
    return json({ error: 'The meal planner had a problem. Try again in a minute.' }, 502);
  }
  const ai = await res.json();
  const text: string = (ai.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
  let plan: any;
  try {
    plan = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  } catch { plan = null; }
  if (!validPlan(plan)) return json({ error: 'The plan came back garbled. Please try again.' }, 502);

  // 5. Save plan (RLS insert policy: user_id = auth.uid()), record tokens, return.
  const { error: sErr } = await supabase.from('meal_plans').insert({ plan });
  if (sErr) console.error('save plan', sErr);
  await supabase.rpc('record_ai_tokens', {
    in_tok: ai.usage?.input_tokens ?? 0, out_tok: ai.usage?.output_tokens ?? 0
  });
  const { data: usage } = await supabase.from('ai_usage').select('calls')
    .eq('user_id', user.id).order('used_on', { ascending: false }).limit(1).maybeSingle();

  return json({ plan, usage: { used: usage?.calls ?? MEMBER_LIMIT, limit: MEMBER_LIMIT } });
});
