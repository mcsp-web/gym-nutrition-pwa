// Real backend: Supabase Auth + Postgres (RLS) + Edge Function for AI.
// Same interface as mock.js. Activated with VITE_DATA_MODE=supabase.
import { createClient } from '@supabase/supabase-js';
import { todayLocal, addDays } from '../lib/dates.js';
import { buildMemberSummary } from '../lib/summary.js';

export const AI_DAILY_LIMIT = 3; // display only; the server enforces AI_DAILY_LIMIT_PER_MEMBER

function fail(error, fallback = 'Something went wrong.') {
  const e = new Error(error?.message || fallback);
  e.status = error?.status || (error?.code === '42501' ? 403 : 400);
  return e;
}

export function createSupabaseBackend({ url, anonKey }) {
  if (!url || !anonKey) throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required in supabase mode.');
  const sb = createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
  let cachedUser = null;

  async function user() {
    const { data } = await sb.auth.getUser();
    return data.user || null;
  }
  async function requireUser() {
    const u = await user();
    if (!u) { const e = new Error('Please sign in.'); e.status = 401; throw e; }
    return u;
  }
  async function profileFor(id) {
    const { data, error } = await sb.from('profiles').select('id, full_name, role').eq('id', id).single();
    if (error) throw fail(error);
    return data;
  }

  return {
    mode: 'supabase',

    auth: {
      async currentUser() {
        const u = await user();
        if (!u) return (cachedUser = null);
        const p = await profileFor(u.id);
        return (cachedUser = { ...p, email: u.email });
      },
      async signIn(email, password) {
        const { error } = await sb.auth.signInWithPassword({ email: String(email).trim(), password });
        if (error) throw fail(error, 'Wrong email or password.');
        return this.currentUser();
      },
      async signUp(email, password, fullName) {
        const { data, error } = await sb.auth.signUp({
          email: String(email).trim(), password,
          options: { data: { full_name: String(fullName || '').slice(0, 80) }, emailRedirectTo: location.origin }
        });
        if (error) throw fail(error);
        if (!data.session) {
          const e = new Error('Check your email to confirm your account, then sign in.');
          e.status = 202; throw e;
        }
        return this.currentUser();
      },
      async signOut() { await sb.auth.signOut(); cachedUser = null; },
      async resetPassword(email) {
        const { error } = await sb.auth.resetPasswordForEmail(String(email).trim(), { redirectTo: `${location.origin}/#/new-password` });
        if (error) throw fail(error);
        return { sent: true, email };
      },
      async setNewPassword(password) {
        const { error } = await sb.auth.updateUser({ password });
        if (error) throw fail(error);
      },
      onChange(cb) {
        const { data } = sb.auth.onAuthStateChange((event) => {
          if (event === 'PASSWORD_RECOVERY') location.hash = '#/new-password';
          cb(event);
        });
        return () => data.subscription.unsubscribe();
      }
    },

    profile: {
      async updateName(full_name) {
        const u = await requireUser();
        const { data, error } = await sb.from('profiles').update({ full_name }).eq('id', u.id).select().single();
        if (error) throw fail(error);
        return data;
      },
      // RLS proof: should fail with "permission denied" because members only have UPDATE on full_name.
      async tryPromoteSelf() {
        const u = await requireUser();
        const { error } = await sb.from('profiles').update({ role: 'admin' }).eq('id', u.id);
        if (error) throw fail(error);
        return 'UNEXPECTED: update succeeded — check the column grants in the migration!';
      }
    },

    macros: {
      async latest() {
        await requireUser();
        const u = await user();
        const { data, error } = await sb.from('macro_plans').select('*').eq('user_id', u.id)
          .order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (error) throw fail(error);
        return data;
      },
      async save({ calories, protein_g, carbs_g, fat_g }) {
        const row = { calories, protein_g, carbs_g, fat_g };
        for (const k in row) { row[k] = Math.round(Number(row[k])); if (!(row[k] >= 0)) throw fail({ message: 'Enter all four targets as positive numbers.' }); }
        const { data, error } = await sb.from('macro_plans').insert(row).select().single();
        if (error) throw fail(error);
        return data;
      }
    },

    meals: {
      async list({ from, to } = {}) {
        const u = await requireUser();
        let q = sb.from('meal_logs').select('*').eq('user_id', u.id).order('created_at', { ascending: false });
        if (from) q = q.gte('logged_on', from);
        if (to) q = q.lte('logged_on', to);
        const { data, error } = await q;
        if (error) throw fail(error);
        return data;
      },
      async add(meal) {
        await requireUser();
        const row = {
          food: String(meal.food || '').trim(), amount: Number(meal.amount), unit: meal.unit,
          protein_g: Number(meal.protein_g) || 0, carbs_g: Number(meal.carbs_g) || 0, fat_g: Number(meal.fat_g) || 0,
          logged_on: meal.logged_on || todayLocal()
        };
        const { data, error } = await sb.from('meal_logs').insert(row).select().single();
        if (error) throw fail(error);
        return data;
      },
      async remove(id) {
        const { error } = await sb.from('meal_logs').delete().eq('id', id);
        if (error) throw fail(error);
      }
    },

    daily: {
      async get(day = todayLocal()) {
        const u = await requireUser();
        const { data, error } = await sb.from('daily_logs').select('*').eq('user_id', u.id).eq('logged_on', day).maybeSingle();
        if (error) throw fail(error);
        return data;
      },
      async upsert({ weight_lb, water_oz, logged_on }) {
        const u = await requireUser();
        const row = {
          user_id: u.id, logged_on: logged_on || todayLocal(),
          weight_lb: weight_lb === '' || weight_lb == null ? null : Number(weight_lb),
          water_oz: water_oz === '' || water_oz == null ? null : Number(water_oz)
        };
        const { data, error } = await sb.from('daily_logs').upsert(row, { onConflict: 'user_id,logged_on' }).select().single();
        if (error) throw fail(error);
        return data;
      }
    },

    ai: {
      async usage() {
        const u = await requireUser();
        const { data, error } = await sb.from('ai_usage').select('calls').eq('user_id', u.id).eq('used_on', todayLocal()).maybeSingle();
        if (error) throw fail(error);
        return { used: data?.calls || 0, limit: AI_DAILY_LIMIT };
      },
      async generatePlan({ preferences = '' } = {}) {
        await requireUser();
        const { data, error } = await sb.functions.invoke('generate-meal-plan', { body: { preferences } });
        if (error) {
          let message = error.message, status = 500;
          try {
            status = error.context?.status ?? status;
            const body = await error.context?.json?.();
            if (body?.error) message = body.error;
          } catch { /* keep defaults */ }
          const e = new Error(message); e.status = status; throw e;
        }
        return data; // { plan, usage: { used, limit } }
      },
      async latestPlan() {
        const u = await requireUser();
        const { data, error } = await sb.from('meal_plans').select('*').eq('user_id', u.id)
          .order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (error) throw fail(error);
        return data;
      }
    },

    admin: {
      // The member_summary view itself is dashboard-only (revoked from the API).
      // This screen rebuilds the same columns from tables the admin can read via RLS (is_admin()).
      async memberSummary() {
        await requireUser();
        const since = addDays(todayLocal(), -60);
        const [p, m, mp, d] = await Promise.all([
          sb.from('profiles').select('id, full_name, role'),
          sb.from('meal_logs').select('user_id, logged_on, protein_g').gte('logged_on', since),
          sb.from('macro_plans').select('user_id, protein_g, created_at'),
          sb.from('daily_logs').select('user_id, logged_on, weight_lb').gte('logged_on', since)
        ]);
        for (const r of [p, m, mp, d]) if (r.error) throw fail(r.error);
        if (!p.data.some((x) => x.role === 'admin' && x.id === cachedUser?.id)) {
          const e = new Error('Admins only.'); e.status = 403; throw e;
        }
        return buildMemberSummary({ profiles: p.data, meals: m.data, macros: mp.data, daily: d.data });
      }
    },

    security: {
      // No app-side owner filter here on purpose: RLS alone decides what comes back.
      async otherMembersMeals() {
        const u = await requireUser();
        const { data, error } = await sb.from('meal_logs').select('id, user_id').neq('user_id', u.id).limit(100);
        if (error) throw fail(error);
        return data;
      }
    },

    demo: null
  };
}
