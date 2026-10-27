-- Demo seed. Run AFTER creating the three test users in
-- Supabase Dashboard → Authentication → Users → "Add user" (tick "Auto confirm"):
--   member.a@demo.test   member.b@demo.test   admin@demo.test
-- Then paste this into the SQL editor.

update public.profiles p set full_name = v.name, role = v.role
from (values
  ('member.a@demo.test', 'Member A (demo)',    'member'),
  ('member.b@demo.test', 'Member B (demo)',    'member'),
  ('admin@demo.test',    'Coach Admin (demo)', 'admin')
) as v(email, name, role)
join auth.users u on u.email = v.email
where p.id = u.id;

-- Targets
insert into public.macro_plans (user_id, calories, protein_g, carbs_g, fat_g)
select id, 2200, 180, 200, 70 from auth.users where email = 'member.a@demo.test'
union all
select id, 1800, 140, 160, 60 from auth.users where email = 'member.b@demo.test';

-- Member A: 5-day streak ending today
insert into public.meal_logs (user_id, logged_on, food, amount, unit, protein_g, carbs_g, fat_g)
select u.id, public.today_local() - g, 'Chicken breast', 6, 'oz', 52, 0, 6
from auth.users u, generate_series(0, 4) g where u.email = 'member.a@demo.test'
union all
select u.id, public.today_local() - g, 'Rice', 2, 'hand_portion', 8, 90, 1
from auth.users u, generate_series(0, 4) g where u.email = 'member.a@demo.test';

insert into public.daily_logs (user_id, logged_on, weight_lb, water_oz)
select u.id, public.today_local() - g, 196 - g * 0.4, 90
from auth.users u, generate_series(0, 4) g where u.email = 'member.a@demo.test';

-- Member B: two days, then a gap (streak should read 0)
insert into public.meal_logs (user_id, logged_on, food, amount, unit, protein_g, carbs_g, fat_g)
select u.id, public.today_local() - g, 'Salmon', 1, 'hand_portion', 30, 0, 12
from auth.users u, generate_series(3, 4) g where u.email = 'member.b@demo.test';

insert into public.daily_logs (user_id, logged_on, weight_lb, water_oz)
select u.id, public.today_local() - g, 158.5, 64
from auth.users u, generate_series(3, 4) g where u.email = 'member.b@demo.test';

-- Check: expect A streak 5 / last log 0, B streak 0 / last log 3
select * from public.member_summary order by full_name;
