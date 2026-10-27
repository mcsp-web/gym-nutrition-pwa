// Browser-only backend for the pre-Supabase demo.
// It enforces the same rules RLS will enforce on the server (members see only
// their own rows, admin reads all, members can't change their role, 3 AI plans
// per day), so the UI and the walkthrough are identical in both modes.
// It is NOT a security boundary — everything lives in this browser's storage.
import { todayLocal, addDays } from '../lib/dates.js';
import { buildMemberSummary } from '../lib/summary.js';
import { mockMealPlan } from '../lib/mockPlan.js';

const KEY = 'fitcode-demo-db-v1';
export const DEMO_PASSWORD = 'demo1234';
export const AI_DAILY_LIMIT = 3;

export const SEED_USERS = [
  { id: 'u-member-a', email: 'member.a@demo.test', full_name: 'Member A (demo)', role: 'member' },
  { id: 'u-member-b', email: 'member.b@demo.test', full_name: 'Member B (demo)', role: 'member' },
  { id: 'u-admin', email: 'admin@demo.test', full_name: 'Coach Admin (demo)', role: 'admin' }
];

function err(message, status = 400) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

function safeStorage() {
  try {
    const t = '__t';
    localStorage.setItem(t, t);
    localStorage.removeItem(t);
    return localStorage;
  } catch {
    return memoryStorage();
  }
}

function seed(today) {
  const db = { seq: 1, users: [], profiles: [], macro_plans: [], meal_logs: [], daily_logs: [], meal_plans: [], ai_usage: [], session: null };
  for (const u of SEED_USERS) {
    db.users.push({ id: u.id, email: u.email, password: DEMO_PASSWORD });
    db.profiles.push({ id: u.id, full_name: u.full_name, role: u.role, created_at: new Date().toISOString() });
  }
  const add = (table, row) => db[table].push({ id: db.seq++, created_at: new Date().toISOString(), ...row });
  add('macro_plans', { user_id: 'u-member-a', calories: 2200, protein_g: 180, carbs_g: 200, fat_g: 70 });
  add('macro_plans', { user_id: 'u-member-b', calories: 1800, protein_g: 140, carbs_g: 160, fat_g: 60 });
  // Member A: 5-day streak ending today. Member B: logged 2 days, then a gap.
  for (let i = 0; i < 5; i++) {
    const d = addDays(today, -i);
    add('meal_logs', { user_id: 'u-member-a', logged_on: d, food: 'Chicken breast', amount: 6, unit: 'oz', protein_g: 52, carbs_g: 0, fat_g: 6 });
    add('meal_logs', { user_id: 'u-member-a', logged_on: d, food: 'Rice', amount: 2, unit: 'hand_portion', protein_g: 8, carbs_g: 90, fat_g: 1 });
    add('daily_logs', { user_id: 'u-member-a', logged_on: d, weight_lb: 196 - i * 0.4, water_oz: 90 });
  }
  for (const i of [3, 4]) {
    const d = addDays(today, -i);
    add('meal_logs', { user_id: 'u-member-b', logged_on: d, food: 'Salmon', amount: 1, unit: 'hand_portion', protein_g: 30, carbs_g: 0, fat_g: 12 });
    add('daily_logs', { user_id: 'u-member-b', logged_on: d, weight_lb: 158.5, water_oz: 64 });
  }
  return db;
}

export function createMockBackend({ storage = safeStorage(), now = () => new Date() } = {}) {
  const today = () => todayLocal(now());
  let db = (() => {
    try {
      const raw = storage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch { /* fall through to seed */ }
    return seed(today());
  })();
  const listeners = new Set();
  const save = () => { try { storage.setItem(KEY, JSON.stringify(db)); } catch { /* storage full/blocked: keep in memory */ } };
  save();

  const uid = () => db.session?.user_id ?? null;
  const me = () => db.profiles.find((p) => p.id === uid()) || null;
  const isAdmin = () => me()?.role === 'admin';
  const requireUser = () => { if (!uid()) throw err('Please sign in.', 401); return uid(); };
  // RLS stand-in: what this caller may read from a table.
  const visible = (table) => db[table].filter((r) => r.user_id === uid() || isAdmin());
  const emit = () => listeners.forEach((cb) => cb(me()));
  const insert = (table, row) => {
    const owner = requireUser();
    // user_id always comes from the session, never from the caller (same as `default auth.uid()` + RLS check).
    const r = { id: db.seq++, created_at: now().toISOString(), ...row, user_id: owner };
    db[table].push(r);
    save();
    return r;
  };

  return {
    mode: 'mock',

    auth: {
      async currentUser() { return me() ? { ...me(), email: db.users.find((u) => u.id === uid())?.email } : null; },
      async signIn(email, password) {
        const u = db.users.find((x) => x.email.toLowerCase() === String(email).trim().toLowerCase());
        if (!u || u.password !== password) throw err('Wrong email or password.', 401);
        db.session = { user_id: u.id };
        save(); emit();
        return this.currentUser();
      },
      async signUp(email, password, fullName) {
        email = String(email).trim().toLowerCase();
        if (!/^\S+@\S+\.\S+$/.test(email)) throw err('Enter a valid email.');
        if (String(password).length < 8) throw err('Password must be at least 8 characters.');
        if (db.users.some((u) => u.email === email)) throw err('An account with that email already exists.');
        const id = 'u-' + Math.random().toString(36).slice(2, 10);
        db.users.push({ id, email, password });
        db.profiles.push({ id, full_name: String(fullName || '').slice(0, 80), role: 'member', created_at: now().toISOString() });
        db.session = { user_id: id };
        save(); emit();
        return this.currentUser();
      },
      async signOut() { db.session = null; save(); emit(); },
      async resetPassword(email) {
        // Supabase sends a reset email. In the demo we just confirm the flow.
        return { sent: true, email, note: 'Demo mode: no email is sent. In the live app Supabase emails a reset link.' };
      },
      onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); }
    },

    profile: {
      async updateName(full_name) {
        requireUser();
        me().full_name = String(full_name).slice(0, 80);
        save();
        return me();
      },
      // Mirrors the column grant: members may not change role. Exposed so the RLS proof can be shown in the UI.
      async tryPromoteSelf() {
        requireUser();
        throw err('permission denied for table profiles (role column is not writable by members)', 403);
      }
    },

    macros: {
      async latest() {
        requireUser();
        return db.macro_plans.filter((m) => m.user_id === uid()).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0] || null;
      },
      async save({ calories, protein_g, carbs_g, fat_g }) {
        const vals = [calories, protein_g, carbs_g, fat_g].map(Number);
        if (vals.some((v) => !Number.isFinite(v) || v < 0)) throw err('Enter all four targets as positive numbers.');
        const [c, p, cb, f] = vals.map(Math.round);
        return insert('macro_plans', { calories: c, protein_g: p, carbs_g: cb, fat_g: f });
      }
    },

    meals: {
      async list({ from, to } = {}) {
        requireUser();
        return db.meal_logs
          .filter((m) => m.user_id === uid())
          .filter((m) => (!from || m.logged_on >= from) && (!to || m.logged_on <= to))
          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      },
      async add({ food, amount, unit, protein_g, carbs_g, fat_g, logged_on }) {
        if (!String(food || '').trim()) throw err('Enter a food name.');
        if (!(Number(amount) > 0)) throw err('Amount must be more than 0.');
        if (!['oz', 'hand_portion'].includes(unit)) throw err('Pick ounces or hand portions.');
        return insert('meal_logs', {
          logged_on: logged_on || today(), food: String(food).trim().slice(0, 120), amount: Number(amount), unit,
          protein_g: Number(protein_g) || 0, carbs_g: Number(carbs_g) || 0, fat_g: Number(fat_g) || 0
        });
      },
      async remove(id) {
        requireUser();
        const i = db.meal_logs.findIndex((m) => m.id === id && m.user_id === uid());
        if (i === -1) throw err('Not found.', 404);
        db.meal_logs.splice(i, 1);
        save();
      }
    },

    daily: {
      async get(day = today()) {
        requireUser();
        return db.daily_logs.find((d) => d.user_id === uid() && d.logged_on === day) || null;
      },
      async upsert({ weight_lb, water_oz, logged_on }) {
        requireUser();
        const day = logged_on || today();
        const w = weight_lb === '' || weight_lb == null ? null : Number(weight_lb);
        const h = water_oz === '' || water_oz == null ? null : Number(water_oz);
        if ((w != null && !(w > 0)) || (h != null && !(h >= 0))) throw err('Enter weight and water as positive numbers.');
        let row = db.daily_logs.find((d) => d.user_id === uid() && d.logged_on === day);
        if (row) Object.assign(row, { weight_lb: w, water_oz: h });
        else row = insert('daily_logs', { logged_on: day, weight_lb: w, water_oz: h });
        save();
        return row;
      }
    },

    ai: {
      async usage() {
        requireUser();
        const row = db.ai_usage.find((u) => u.user_id === uid() && u.used_on === today());
        return { used: row?.calls || 0, limit: AI_DAILY_LIMIT };
      },
      async generatePlan({ preferences = '' } = {}) {
        requireUser();
        if (String(preferences).length > 500) throw err('Keep preferences under 500 characters.');
        const target = await this._target();
        if (!target) throw err('Save your macro targets first.');
        let row = db.ai_usage.find((u) => u.user_id === uid() && u.used_on === today());
        if (!row) { row = { user_id: uid(), used_on: today(), calls: 0 }; db.ai_usage.push(row); }
        if (row.calls >= AI_DAILY_LIMIT) {
          throw err(`You've used today's ${AI_DAILY_LIMIT} meal plans. New ones tomorrow.`, 429);
        }
        row.calls += 1;
        const plan = mockMealPlan(target, preferences);
        const saved = insert('meal_plans', { plan });
        return { plan: saved.plan, usage: { used: row.calls, limit: AI_DAILY_LIMIT } };
      },
      async _target() {
        return db.macro_plans.filter((m) => m.user_id === uid()).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0] || null;
      },
      async latestPlan() {
        requireUser();
        return db.meal_plans.filter((m) => m.user_id === uid()).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0] || null;
      }
    },

    admin: {
      async memberSummary() {
        requireUser();
        if (!isAdmin()) throw err('Admins only.', 403);
        return buildMemberSummary({
          profiles: db.profiles,
          meals: visible('meal_logs'),
          macros: visible('macro_plans'),
          daily: visible('daily_logs')
        }, today());
      }
    },

    security: {
      // "Give me everyone else's meals" with no app-side filter; the RLS stand-in decides.
      async otherMembersMeals() {
        requireUser();
        return visible('meal_logs').filter((m) => m.user_id !== uid());
      }
    },

    // Demo helpers (mock mode only)
    demo: {
      users: SEED_USERS.map(({ email, full_name, role }) => ({ email, full_name, role, password: DEMO_PASSWORD })),
      reset() { db = seed(today()); save(); emit(); }
    }
  };
}
