import './style.css';
import { loadBackend } from './data/index.js';
import { todayLocal, addDays, shortDay } from './lib/dates.js';

const app = document.getElementById('app');
let api;
let user = null;

// ---------- helpers ----------
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n0 = (v) => Math.round(Number(v) || 0);
const $ = (sel, root = app) => root.querySelector(sel);

let toastTimer;
function toast(msg, isError = false) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast' + (isError ? ' error' : '');
  t.setAttribute('role', 'status');
  t.textContent = msg;
  document.body.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 3200);
}

async function busy(btn, fn) {
  const label = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner" aria-hidden="true"></span>';
  try { return await fn(); }
  catch (e) { toast(e.message || 'Something went wrong.', true); throw e; }
  finally { btn.disabled = false; btn.innerHTML = label; }
}

const ICONS = {
  today: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 13h4l3-8 3 14 3-6h3"/></svg>',
  log: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  plan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3l2.4 5 5.6.8-4 3.9.9 5.5L12 15.6 7.1 18.2l.9-5.5-4-3.9 5.6-.8z"/></svg>',
  members: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 4a3 3 0 010 6M21 20c0-2.6-1.6-4.8-4-5.6"/></svg>',
  account: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>'
};

function header() {
  return `
    <header class="top">
      <div class="wordmark">FitCode <span>Nutrition</span><small>Pilot demo</small></div>
      <div class="top-right">
        ${user ? `<span class="chip ${user.role === 'admin' ? 'admin' : ''}">${user.role === 'admin' ? 'Admin' : esc(user.full_name || user.email)}</span>` : ''}
        <a class="help-link" href="#/help" aria-label="Help and how it works">?</a>
      </div>
    </header>
    ${api.mode === 'mock' ? '<div class="banner">Demo mode: test data stays in this browser. The live version runs on Supabase with row-level security.</div>' : ''}`;
}

const footer = () => `<p class="footer">Demo built by MCSP Consulting for FitCode — not an official FitCode app.</p>`;

function tabbar(active) {
  const tabs = [['today', 'Today'], ['log', 'Log'], ['plan', 'Plan']];
  if (user?.role === 'admin') tabs.push(['members', 'Members']);
  tabs.push(['account', 'Account']);
  return `<div class="tabbar"><nav aria-label="Main">${tabs.map(([k, l]) =>
    `<a href="#/${k}" ${k === active ? 'aria-current="page"' : ''}>${ICONS[k]}<span>${l}</span></a>`).join('')}</nav></div>`;
}

function page(active, body) {
  app.innerHTML = `<main class="shell">${header()}${body}${footer()}</main>${tabbar(active)}`;
  window.scrollTo(0, 0);
}

function authPage(body) {
  app.innerHTML = `<main class="shell no-tabs">${header()}${body}${footer()}</main>`;
}

function bar(label, value, target, unit = 'g') {
  const pct = target ? Math.min(100, (value / target) * 100) : 0;
  const over = target && value > target * 1.05;
  return `<div class="bar">
    <div class="bar-head"><span>${label}</span><span class="muted">${n0(value)} / ${target ? n0(target) : '—'} ${unit}</span></div>
    <div class="bar-track" role="progressbar" aria-label="${label}" aria-valuemin="0" aria-valuemax="${n0(target)}" aria-valuenow="${n0(value)}">
      <div class="bar-fill ${over ? 'over' : ''}" style="width:${pct}%"></div>
    </div></div>`;
}

const unitLabel = (u, amt) => (u === 'oz' ? `${amt} oz` : `${amt} hand portion${Number(amt) === 1 ? '' : 's'}`);

// ---------- auth screens ----------
function viewLogin() {
  const demo = api.demo?.users || [];
  authPage(`
    <section class="card hero">
      <h1>Eat for your training.</h1>
      <p class="muted">Track macros by ounces or hand portions, log weight and water, and get an AI meal plan built on your targets.</p>
    </section>
    <form class="card" id="f">
      <h2>Sign in</h2>
      <div class="field"><label for="email">Email</label><input id="email" type="email" autocomplete="email" required></div>
      <div class="field"><label for="pw">Password</label><input id="pw" type="password" autocomplete="current-password" required></div>
      <button class="btn" type="submit">Sign in</button>
      <p class="row small" style="margin:14px 0 0"><a href="#/signup">Create account</a><a href="#/reset" style="text-align:right">Forgot password?</a></p>
    </form>
    ${demo.length ? `<section class="card"><h2>Test accounts</h2><p class="muted small">Tap one to sign in. Password for all: <code>${esc(demo[0].password)}</code></p>
      <div class="demo-users">${demo.map((u) => `<button type="button" data-email="${esc(u.email)}" data-pw="${esc(u.password)}"><b>${esc(u.full_name)}</b><span>${esc(u.email)} · ${u.role}</span></button>`).join('')}</div></section>` : ''}`);
  $('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    await busy(e.submitter, async () => { user = await api.auth.signIn($('#email').value, $('#pw').value); location.hash = '#/today'; }).catch(() => {});
  });
  app.querySelectorAll('.demo-users button').forEach((b) => b.addEventListener('click', async () => {
    try { user = await api.auth.signIn(b.dataset.email, b.dataset.pw); location.hash = '#/today'; } catch (e) { toast(e.message, true); }
  }));
}

function viewSignup() {
  authPage(`
    <form class="card" id="f">
      <h2>Create account</h2>
      <div class="field"><label for="name">Full name</label><input id="name" autocomplete="name" maxlength="80" required></div>
      <div class="field"><label for="email">Email</label><input id="email" type="email" autocomplete="email" required></div>
      <div class="field"><label for="pw">Password (8+ characters)</label><input id="pw" type="password" autocomplete="new-password" minlength="8" required></div>
      <button class="btn" type="submit">Create account</button>
      <p class="small" style="margin:14px 0 0"><a href="#/login">Back to sign in</a></p>
    </form>`);
  $('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await busy(e.submitter, async () => { user = await api.auth.signUp($('#email').value, $('#pw').value, $('#name').value); });
      location.hash = '#/plan';
      toast('Welcome! Start by setting your macro targets.');
    } catch (err) {
      if (err.status === 202) { location.hash = '#/login'; toast(err.message); }
    }
  });
}

function viewReset() {
  authPage(`
    <form class="card" id="f">
      <h2>Reset password</h2>
      <p class="muted small">Enter your email and we'll send you a link to set a new password.</p>
      <div class="field"><label for="email">Email</label><input id="email" type="email" autocomplete="email" required></div>
      <button class="btn" type="submit">Send reset link</button>
      <p class="small" style="margin:14px 0 0"><a href="#/login">Back to sign in</a></p>
    </form>`);
  $('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await busy(e.submitter, () => api.auth.resetPassword($('#email').value)).catch(() => null);
    if (r) toast(r.note || 'If that email has an account, a reset link is on its way.');
  });
}

function viewNewPassword() {
  authPage(`
    <form class="card" id="f">
      <h2>Set a new password</h2>
      <div class="field"><label for="pw">New password (8+ characters)</label><input id="pw" type="password" autocomplete="new-password" minlength="8" required></div>
      <button class="btn" type="submit">Save password</button>
    </form>`);
  $('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!api.auth.setNewPassword) { location.hash = '#/login'; return; }
    await busy(e.submitter, () => api.auth.setNewPassword($('#pw').value)).then(() => { toast('Password updated.'); location.hash = '#/today'; }).catch(() => {});
  });
}

// ---------- member screens ----------
async function viewToday() {
  const today = todayLocal();
  const [target, meals, daily, week] = await Promise.all([
    api.macros.latest(), api.meals.list({ from: today, to: today }), api.daily.get(today),
    api.meals.list({ from: addDays(today, -6), to: today })
  ]);
  const t = meals.reduce((a, m) => ({ p: a.p + +m.protein_g, c: a.c + +m.carbs_g, f: a.f + +m.fat_g }), { p: 0, c: 0, f: 0 });
  const kcal = t.p * 4 + t.c * 4 + t.f * 9;
  const byDay = new Map();
  week.forEach((m) => byDay.set(m.logged_on, (byDay.get(m.logged_on) || 0) + +m.protein_g));
  const avg7 = byDay.size ? [...byDay.values()].reduce((a, b) => a + b, 0) / byDay.size : 0;

  page('today', `
    <h1>${esc(shortDay(today))}</h1>
    ${target ? '' : `<div class="card hero"><h2>Set your targets</h2><p class="muted">Add calories and macros to see your progress here.</p><a class="btn" href="#/plan">Set targets</a></div>`}
    <section class="card">
      <h2>Today vs. target</h2>
      ${bar('Calories', kcal, target?.calories, 'kcal')}
      ${bar('Protein', t.p, target?.protein_g)}
      ${bar('Carbs', t.c, target?.carbs_g)}
      ${bar('Fat', t.f, target?.fat_g)}
      <a class="btn ghost" href="#/log">Log a meal</a>
    </section>
    <section class="grid2">
      <div class="card"><h3>7-day protein avg</h3><div class="stat">${n0(avg7)}<small> g/day</small></div>
        <p class="muted small" style="margin:6px 0 0">${target ? `Target ${n0(target.protein_g)} g` : 'No target yet'} · ${byDay.size} day${byDay.size === 1 ? '' : 's'} logged</p></div>
      <div class="card"><h3>Meals today</h3><div class="stat">${meals.length}</div></div>
    </section>
    <form class="card" id="daily">
      <h2>Daily check-in</h2>
      <div class="row">
        <div class="field"><label for="w">Weight (lb)</label><input id="w" type="number" inputmode="decimal" step="0.1" min="0" value="${esc(daily?.weight_lb ?? '')}"></div>
        <div class="field"><label for="h">Water (oz)</label><input id="h" type="number" inputmode="numeric" step="1" min="0" value="${esc(daily?.water_oz ?? '')}"></div>
      </div>
      <button class="btn ghost" type="submit">Save check-in</button>
    </form>`);
  $('#daily').addEventListener('submit', async (e) => {
    e.preventDefault();
    await busy(e.submitter, () => api.daily.upsert({ weight_lb: $('#w').value, water_oz: $('#h').value })).then(() => toast('Check-in saved.')).catch(() => {});
  });
}

async function viewLog() {
  const today = todayLocal();
  const meals = await api.meals.list({ from: today, to: today });
  page('log', `
    <h1>Log a meal</h1>
    <form class="card" id="f">
      <div class="field"><label for="food">Food</label><input id="food" maxlength="120" placeholder="e.g. Grilled chicken" required></div>
      <div class="field"><label>Measure by</label>
        <div class="seg" role="group" aria-label="Unit">
          <button type="button" data-unit="oz" aria-pressed="true">Ounces</button>
          <button type="button" data-unit="hand_portion" aria-pressed="false">Hand portions</button>
        </div></div>
      <div class="field"><label for="amt" id="amt-l">Amount (oz)</label><input id="amt" type="number" inputmode="decimal" step="0.25" min="0.25" required></div>
      <div class="row">
        <div class="field"><label for="p">Protein g</label><input id="p" type="number" inputmode="decimal" min="0" step="1"></div>
        <div class="field"><label for="c">Carbs g</label><input id="c" type="number" inputmode="decimal" min="0" step="1"></div>
        <div class="field"><label for="fa">Fat g</label><input id="fa" type="number" inputmode="decimal" min="0" step="1"></div>
      </div>
      <p class="muted small" style="margin-top:0">Hand portions: palm = protein, fist = veggies, cupped hand = carbs, thumb = fats.</p>
      <button class="btn" type="submit">Add meal</button>
    </form>
    <section class="card"><h2>Today</h2>
      ${meals.length ? `<ul class="list">${meals.map((m) => `
        <li><div><b>${esc(m.food)}</b><div class="meta">${esc(unitLabel(m.unit, m.amount))} · P ${n0(m.protein_g)} · C ${n0(m.carbs_g)} · F ${n0(m.fat_g)}</div></div>
        <button class="icon-btn" data-del="${esc(m.id)}" aria-label="Delete ${esc(m.food)}">Delete</button></li>`).join('')}</ul>`
        : '<p class="muted">Nothing logged yet today.</p>'}
    </section>`);
  let unit = 'oz';
  app.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => {
    unit = b.dataset.unit;
    app.querySelectorAll('.seg button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    $('#amt-l').textContent = unit === 'oz' ? 'Amount (oz)' : 'Amount (hand portions)';
    $('#amt').step = unit === 'oz' ? '0.25' : '0.5';
  }));
  $('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    await busy(e.submitter, () => api.meals.add({
      food: $('#food').value, amount: $('#amt').value, unit,
      protein_g: $('#p').value, carbs_g: $('#c').value, fat_g: $('#fa').value
    })).then(() => { toast('Meal logged.'); viewLog(); }).catch(() => {});
  });
  app.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    const id = isNaN(+b.dataset.del) ? b.dataset.del : +b.dataset.del;
    await busy(b, () => api.meals.remove(id)).then(viewLog).catch(() => {});
  }));
}

function renderPlan(plan) {
  if (!plan) return '<p class="muted">No plan yet. Generate one below.</p>';
  const p = plan.plan || plan;
  return `${(p.meals || []).map((m) => `<div class="plan-meal"><h3>${esc(m.name)}</h3>${(m.items || []).map((i) =>
      `<div class="plan-item"><span>${esc(i.food)} <span class="muted">· ${esc(i.amount)}</span></span><span class="m">P${n0(i.protein_g)} C${n0(i.carbs_g)} F${n0(i.fat_g)}</span></div>`).join('')}</div>`).join('')}
    ${p.totals ? `<p class="small muted" style="margin-bottom:0">Total ≈ ${n0(p.totals.calories)} kcal · P ${n0(p.totals.protein_g)} · C ${n0(p.totals.carbs_g)} · F ${n0(p.totals.fat_g)}</p>` : ''}
    ${p.notes ? `<p class="small muted">${esc(p.notes)}</p>` : ''}`;
}

function usageHtml({ used, limit }) {
  const left = Math.max(0, limit - used);
  return `<div class="usage"><span class="dots" aria-hidden="true">${Array.from({ length: limit }, (_, i) => `<i class="${i < used ? 'used' : ''}"></i>`).join('')}</span>
    <span><b>${left} of ${limit}</b> AI plans left today</span></div>`;
}

async function viewPlan() {
  const [target, usage, latest] = await Promise.all([api.macros.latest(), api.ai.usage(), api.ai.latestPlan()]);
  page('plan', `
    <h1>Meal plan</h1>
    <form class="card" id="macros">
      <h2>Your daily targets</h2>
      <div class="grid2">
        <div class="field"><label for="kc">Calories</label><input id="kc" type="number" inputmode="numeric" min="0" required value="${esc(target?.calories ?? '')}"></div>
        <div class="field"><label for="mp">Protein g</label><input id="mp" type="number" inputmode="numeric" min="0" required value="${esc(target?.protein_g ?? '')}"></div>
        <div class="field"><label for="mc">Carbs g</label><input id="mc" type="number" inputmode="numeric" min="0" required value="${esc(target?.carbs_g ?? '')}"></div>
        <div class="field"><label for="mf">Fat g</label><input id="mf" type="number" inputmode="numeric" min="0" required value="${esc(target?.fat_g ?? '')}"></div>
      </div>
      <button class="btn ghost" type="submit">Save targets</button>
    </form>
    <section class="card hero">
      <h2>AI meal plan</h2>
      <div id="usage">${usageHtml(usage)}</div>
      <div class="field" style="margin-top:12px"><label for="pref">Preferences (optional)</label>
        <textarea id="pref" maxlength="500" placeholder="e.g. no pork, quick lunches, I train at 6 am"></textarea></div>
      <button class="btn" id="gen" ${usage.used >= usage.limit ? 'disabled' : ''}>${usage.used >= usage.limit ? 'Limit reached — back tomorrow' : 'Generate meal plan'}</button>
      <p class="muted small" style="margin-bottom:0">Plans are written on the server. Each member gets ${usage.limit} per day so costs stay predictable.</p>
    </section>
    <section class="card"><h2>Latest plan</h2><div id="plan">${renderPlan(latest)}</div></section>`);
  $('#macros').addEventListener('submit', async (e) => {
    e.preventDefault();
    await busy(e.submitter, () => api.macros.save({ calories: $('#kc').value, protein_g: $('#mp').value, carbs_g: $('#mc').value, fat_g: $('#mf').value }))
      .then(() => toast('Targets saved.')).catch(() => {});
  });
  $('#gen').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    try {
      const r = await busy(btn, () => api.ai.generatePlan({ preferences: $('#pref').value }));
      $('#plan').innerHTML = renderPlan(r.plan);
      $('#usage').innerHTML = usageHtml(r.usage);
      if (r.usage.used >= r.usage.limit) { btn.disabled = true; btn.textContent = 'Limit reached — back tomorrow'; }
      toast('New plan ready.');
      $('#plan').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      if (err.status === 429) { btn.disabled = true; btn.textContent = 'Limit reached — back tomorrow'; $('#usage').innerHTML = usageHtml({ used: usage.limit, limit: usage.limit }); }
    }
  });
}

async function viewMembers() {
  if (user?.role !== 'admin') { location.hash = '#/today'; return; }
  const rows = await api.admin.memberSummary();
  const v = (x, suffix = '') => (x == null ? '<span class="muted">—</span>' : esc(x) + suffix);
  page('members', `
    <h1>Members</h1>
    <section class="card">
      <p class="muted small" style="margin-top:0">Read-only. Same columns as the <code>member_summary</code> view the owner reads in the Supabase dashboard.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Member</th><th>Last log</th><th>Streak</th><th>Protein 7d</th><th>Target</th><th>Weight</th></tr></thead>
        <tbody>${rows.map((r) => `<tr>
          <td>${esc(r.full_name || '(no name)')}</td>
          <td>${r.days_since_last_log == null ? '<span class="muted">never</span>' : r.days_since_last_log === 0 ? 'today' : `${r.days_since_last_log}d ago`}</td>
          <td>${v(r.current_streak, 'd')}</td>
          <td>${v(r.avg_protein_7d_logged_days, ' g')}</td>
          <td>${v(r.protein_target, ' g')}</td>
          <td>${v(r.latest_weight, ' lb')}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No members yet.</td></tr>'}</tbody>
      </table></div>
    </section>`);
}

async function viewAccount() {
  page('account', `
    <h1>Account</h1>
    <form class="card" id="f">
      <div class="field"><label for="name">Name</label><input id="name" maxlength="80" value="${esc(user.full_name)}"></div>
      <p class="muted small">Email: ${esc(user.email)} · Role: ${esc(user.role)}</p>
      <button class="btn ghost" type="submit">Save name</button>
    </form>
    <section class="card">
      <h2>Security checks</h2>
      <p class="muted small" style="margin-top:0">Run these to see the data rules in action.</p>
      <div class="row">
        <button class="btn ghost sm" id="peek" type="button">Read other members' meals</button>
        <button class="btn ghost sm" id="promote" type="button">Make myself admin</button>
      </div>
      <div id="checks"></div>
    </section>
    <button class="btn white" id="out">Sign out</button>
    ${api.demo ? '<p style="text-align:center;margin-top:16px"><button class="link" id="reset">Reset demo data</button></p>' : ''}`);
  const report = (pass, html) => $('#checks').insertAdjacentHTML('afterbegin', `<div class="check ${pass ? 'pass' : 'fail'}"><span>${pass ? '✓' : '✗'}</span><div>${html}</div></div>`);
  $('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    await busy(e.submitter, () => api.profile.updateName($('#name').value)).then((p) => { user.full_name = p.full_name; toast('Saved.'); }).catch(() => {});
  });
  $('#peek').addEventListener('click', async () => {
    // Asks for meal rows that belong to anyone else, with no app-side filter. RLS decides what comes back.
    const rows = await api.security.otherMembersMeals();
    if (user.role === 'admin') report(true, `Admin can read all members: <b>${rows.length}</b> rows from other members.`);
    else report(rows.length === 0, rows.length === 0
      ? 'Asked for every member\'s meals — got <b>0</b> rows that aren\'t mine. Members only see their own data.'
      : `Got ${rows.length} rows from other members — this should never happen.`);
  });
  $('#promote').addEventListener('click', async () => {
    try {
      const msg = await api.profile.tryPromoteSelf();
      report(user.role === 'admin', esc(msg || 'Update succeeded.'));
    } catch (e) {
      report(true, `Blocked as expected: <code>${esc(e.message)}</code>`);
    }
  });
  $('#out').addEventListener('click', async () => { await api.auth.signOut(); user = null; location.hash = '#/login'; });
  $('#reset')?.addEventListener('click', () => { api.demo.reset(); user = null; location.hash = '#/login'; toast('Demo data reset.'); });
}

// ---------- help ----------
function viewHelp() {
  const isMock = api.mode === 'mock';
  const limit = 3;
  const qa = (title, body, open = false) => `<details class="help-item" ${open ? 'open' : ''}><summary>${title}</summary><div class="help-body">${body}</div></details>`;
  const body = `
    <h1>Help</h1>
    <p class="muted" style="margin-top:-4px">How the app works, in under two minutes.</p>
    ${isMock ? '<div class="card"><h2>About this demo</h2><p class="small" style="margin:0">This is a preview with test accounts. Anything you enter stays in this browser only. In the live version, accounts and data are stored securely on the server, and meal plans are written by Claude AI.</p></div>' : ''}
    <section class="card help">
      ${qa('1. Getting started', `<ol>
        <li>Sign in, or tap <b>Create account</b> with your email and a password (8+ characters).</li>
        <li>Open <b>Plan</b> and enter your daily targets: calories, protein, carbs and fat. Your coach can give you these numbers.</li>
        <li>Log what you eat on <b>Log</b>, and check your progress on <b>Today</b>.</li></ol>`, true)}
      ${qa('2. Logging a meal', `<p>Enter the food, then choose how you measured it:</p>
        <ul><li><b>Ounces</b> if you weighed it.</li>
        <li><b>Hand portions</b> if you eyeballed it: a <b>palm</b> of protein, a <b>fist</b> of vegetables, a <b>cupped hand</b> of carbs, a <b>thumb</b> of fats.</li></ul>
        <p>Add the protein, carbs and fat grams if you know them. Made a mistake? Tap <b>Delete</b> next to the meal in today's list.</p>`)}
      ${qa('3. The Today screen', `<ul><li>Bars show what you've eaten today against your targets. A bar turns amber when you go more than 5% over.</li>
        <li><b>7-day protein avg</b> averages the days you logged in the past week.</li>
        <li><b>Daily check-in</b> saves your weight and water. Saving again the same day updates it.</li></ul>
        <p>Days run on Chicago time, so the day turns over at midnight Central.</p>`)}
      ${qa('4. AI meal plans', `<ul><li>On <b>Plan</b>, tap <b>Generate meal plan</b> for one day of meals built around your targets.</li>
        <li>Add preferences such as foods you avoid or when you train, and the plan follows them.</li>
        <li>Each member gets <b>${limit} plans per day</b>. The dots show how many you have left; they reset at midnight Chicago time.</li>
        <li>Plans are written on the server, so no AI keys or account details ever sit on your phone.</li></ul>
        <p class="small muted">Meal plans are general guidance, not medical advice. Check with your coach or doctor about allergies or health conditions.</p>`)}
      ${qa('5. Install it on your phone', `<p><b>iPhone</b></p>
        <ol><li>Open the site in <b>Safari</b>.</li><li>Tap the <b>Share</b> button (square with an arrow).</li><li>Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.</li></ol>
        <p><b>Android</b></p>
        <ol><li>Open the site in <b>Chrome</b>.</li><li>Tap <b>Install app</b> when it pops up, or open the <b>⋮</b> menu and choose <b>Install app</b> (or <b>Add to Home screen</b>).</li></ol>
        <p>It then opens full screen from its own icon, like a regular app.</p>`)}
      ${qa('6. Your data and privacy', `<ul><li>Only you can see your meals, weight and plans. The database itself blocks other members from reading them, not just the app screens.</li>
        <li>Gym staff with an admin account can view member summaries to support your coaching.</li>
        <li>Members can't change their own access level.</li>
        <li>Want to check? <b>Account → Security checks</b> runs both tests live.</li></ul>`)}
      ${qa('7. For coaches (admin accounts)', `<p>Admins get a <b>Members</b> tab: each member's days since last log, current logging streak, 7-day protein average against target, and latest weight. It's read-only.</p>`)}
      ${qa('8. Something not working?', `<ul><li><b>App looks out of date:</b> close it fully and reopen it once or twice to load the latest version.</li>
        <li><b>Forgot password:</b> tap <b>Forgot password?</b> on the sign-in screen for a reset link.</li>
        <li><b>"Limit reached":</b> you've used today's ${limit} meal plans; more are available after midnight Chicago time.</li></ul>`)}
    </section>
    <a class="btn ghost" href="${user ? '#/today' : '#/login'}">${user ? 'Back to Today' : 'Back to sign in'}</a>`;
  if (user) page('help', body); else authPage(body);
}

// ---------- router ----------
const PUBLIC = { login: viewLogin, signup: viewSignup, reset: viewReset, 'new-password': viewNewPassword };
const PRIVATE = { today: viewToday, log: viewLog, plan: viewPlan, members: viewMembers, account: viewAccount };

async function route() {
  const key = (location.hash.replace(/^#\/?/, '') || 'today').split('?')[0];
  try {
    if (key === 'help') return viewHelp();
    if (PUBLIC[key]) {
      if (user && key !== 'new-password') { location.hash = '#/today'; return; }
      return PUBLIC[key]();
    }
    if (!user) { location.hash = '#/login'; return; }
    return await (PRIVATE[key] || viewToday)();
  } catch (e) {
    if (e.status === 401) { user = null; location.hash = '#/login'; return; }
    console.error(e);
    toast(e.message || 'Something went wrong.', true);
  }
}

async function boot() {
  app.innerHTML = '<div class="center"><span class="spinner"></span></div>';
  try {
    api = await loadBackend();
    user = await api.auth.currentUser();
  } catch (e) {
    app.innerHTML = `<main class="shell no-tabs"><div class="card"><h2>Setup needed</h2><p class="muted">${esc(e.message)}</p></div></main>`;
    return;
  }
  api.auth.onChange(async () => { user = await api.auth.currentUser().catch(() => null); });
  window.addEventListener('hashchange', route);
  route();
}

boot();
