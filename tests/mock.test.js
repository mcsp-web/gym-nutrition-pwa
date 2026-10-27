// Run: npm test
// Verifies the rules the demo walkthrough shows (they mirror the Postgres RLS + cap).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockBackend, DEMO_PASSWORD } from '../src/data/mock.js';
import { currentStreak, avgProtein7d } from '../src/lib/summary.js';
import { todayLocal, addDays } from '../src/lib/dates.js';

function mem() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
const fresh = () => createMockBackend({ storage: mem() });

test('members only see their own meals; admin sees everyone', async () => {
  const api = fresh();
  await api.auth.signIn('member.a@demo.test', DEMO_PASSWORD);
  await api.meals.add({ food: 'Steak', amount: 8, unit: 'oz', protein_g: 60 });
  assert.equal((await api.security.otherMembersMeals()).length, 0);
  const aMeals = await api.meals.list();
  assert.ok(aMeals.every((m) => m.user_id === 'u-member-a'));

  await api.auth.signIn('member.b@demo.test', DEMO_PASSWORD);
  assert.equal((await api.security.otherMembersMeals()).length, 0);
  assert.ok((await api.meals.list()).every((m) => m.user_id === 'u-member-b'));

  await api.auth.signIn('admin@demo.test', DEMO_PASSWORD);
  assert.ok((await api.security.otherMembersMeals()).length > 0);
});

test('user_id comes from the session, not the payload', async () => {
  const api = fresh();
  await api.auth.signIn('member.b@demo.test', DEMO_PASSWORD);
  const row = await api.meals.add({ food: 'Eggs', amount: 1, unit: 'hand_portion', user_id: 'u-member-a' });
  assert.equal(row.user_id, 'u-member-b');
});

test('members cannot promote themselves', async () => {
  const api = fresh();
  await api.auth.signIn('member.a@demo.test', DEMO_PASSWORD);
  await assert.rejects(() => api.profile.tryPromoteSelf(), { status: 403 });
});

test('non-admins cannot read the member summary', async () => {
  const api = fresh();
  await api.auth.signIn('member.a@demo.test', DEMO_PASSWORD);
  await assert.rejects(() => api.admin.memberSummary(), { status: 403 });
});

test('3 AI plans per day, 4th refused with 429', async () => {
  const api = fresh();
  await api.auth.signIn('member.a@demo.test', DEMO_PASSWORD);
  for (let i = 1; i <= 3; i++) {
    const r = await api.ai.generatePlan({ preferences: 'no pork' });
    assert.equal(r.usage.used, i);
    assert.ok(r.plan.meals.length >= 3);
  }
  await assert.rejects(() => api.ai.generatePlan(), { status: 429 });
  // Another member still has their own allowance.
  await api.auth.signIn('member.b@demo.test', DEMO_PASSWORD);
  assert.equal((await api.ai.usage()).used, 0);
});

test('cap resets on the next Chicago day', async () => {
  let now = new Date('2026-10-26T15:00:00Z');
  const api = createMockBackend({ storage: mem(), now: () => now });
  await api.auth.signIn('member.a@demo.test', DEMO_PASSWORD);
  for (let i = 0; i < 3; i++) await api.ai.generatePlan();
  await assert.rejects(() => api.ai.generatePlan(), { status: 429 });
  now = new Date('2026-10-27T06:00:00Z'); // 1 am Chicago next day
  assert.equal((await api.ai.usage()).used, 0);
});

test('admin summary matches seed: A streak 5, B streak 0 with 3-day gap', async () => {
  const api = fresh();
  await api.auth.signIn('admin@demo.test', DEMO_PASSWORD);
  const rows = await api.admin.memberSummary();
  const a = rows.find((r) => r.full_name.startsWith('Member A'));
  const b = rows.find((r) => r.full_name.startsWith('Member B'));
  assert.equal(rows.length, 2, 'admin row excluded');
  assert.equal(a.current_streak, 5);
  assert.equal(a.days_since_last_log, 0);
  assert.equal(a.avg_protein_7d_logged_days, 60);
  assert.equal(a.protein_target, 180);
  assert.equal(b.current_streak, 0);
  assert.equal(b.days_since_last_log, 3);
});

test('streak counts a run ending yesterday', () => {
  const t = '2026-10-26';
  assert.equal(currentStreak(['2026-10-23', '2026-10-24', '2026-10-25'], t), 3);
  assert.equal(currentStreak(['2026-10-23', '2026-10-24'], t), 0);
  assert.equal(currentStreak([], t), 0);
});

test('7-day protein average ignores days with no logs', () => {
  const t = '2026-10-26';
  const meals = [
    { logged_on: t, protein_g: 100 }, { logged_on: t, protein_g: 50 },
    { logged_on: addDays(t, -2), protein_g: 90 }, { logged_on: addDays(t, -10), protein_g: 999 }
  ];
  assert.equal(avgProtein7d(meals, t), 120);
});

test('todayLocal uses Chicago, not UTC', () => {
  // 02:00 UTC on Oct 27 is still Oct 26 in Chicago (CDT, UTC-5).
  assert.equal(todayLocal(new Date('2026-10-27T02:00:00Z')), '2026-10-26');
});
