// All "days" in the app are gym-local (Chicago), matching public.today_local() in Postgres.
export const GYM_TZ = 'America/Chicago';

export function todayLocal(now = new Date()) {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: GYM_TZ, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now);
}

export function addDays(isoDate, n) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export function daysBetween(fromIso, toIso) {
  const a = Date.UTC(...fromIso.split('-').map((v, i) => (i === 1 ? v - 1 : +v)));
  const b = Date.UTC(...toIso.split('-').map((v, i) => (i === 1 ? v - 1 : +v)));
  return Math.round((b - a) / 86400000);
}

export function shortDay(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC'
  });
}
