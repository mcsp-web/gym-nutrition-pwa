// JS mirror of the public.member_summary view (supabase/migrations). Used by the
// in-app admin screen in both mock and Supabase modes. Keep the two in sync.
import { addDays, daysBetween, todayLocal } from './dates.js';

export function currentStreak(loggedDays, today = todayLocal()) {
  const days = new Set(loggedDays);
  let start = days.has(today) ? today : days.has(addDays(today, -1)) ? addDays(today, -1) : null;
  if (!start) return 0;
  let n = 0;
  for (let d = start; days.has(d); d = addDays(d, -1)) n++;
  return n;
}

export function avgProtein7d(meals, today = todayLocal()) {
  const from = addDays(today, -6);
  const byDay = new Map();
  for (const m of meals) {
    if (m.logged_on < from || m.logged_on > today) continue;
    byDay.set(m.logged_on, (byDay.get(m.logged_on) || 0) + Number(m.protein_g || 0));
  }
  if (!byDay.size) return null;
  const total = [...byDay.values()].reduce((a, b) => a + b, 0);
  return Math.round((total / byDay.size) * 10) / 10;
}

/**
 * @param profiles  [{id, full_name, role}]
 * @param meals     [{user_id, logged_on, protein_g}]
 * @param macros    [{user_id, protein_g, created_at}]
 * @param daily     [{user_id, logged_on, weight_lb}]
 */
export function buildMemberSummary({ profiles, meals, macros, daily }, today = todayLocal()) {
  return profiles
    .filter((p) => p.role === 'member')
    .map((p) => {
      const myMeals = meals.filter((m) => m.user_id === p.id);
      const days = [...new Set(myMeals.map((m) => m.logged_on))].sort();
      const last = days[days.length - 1];
      const target = macros
        .filter((m) => m.user_id === p.id)
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
      const weight = daily
        .filter((d) => d.user_id === p.id && d.weight_lb != null)
        .sort((a, b) => (a.logged_on < b.logged_on ? 1 : -1))[0];
      return {
        id: p.id,
        full_name: p.full_name,
        days_since_last_log: last ? daysBetween(last, today) : null,
        current_streak: currentStreak(days, today),
        avg_protein_7d_logged_days: avgProtein7d(myMeals, today),
        protein_target: target ? target.protein_g : null,
        latest_weight: weight ? Number(weight.weight_lb) : null
      };
    });
}
