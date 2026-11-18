-- ============================================================
-- ONLINE EXAMINATION SYSTEM – database schema
-- Run this WHOLE file once:  Supabase → SQL Editor → New query → Run
-- ============================================================

-- ---------- 1. TABLES ----------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  full_name text,
  role text not null default 'student' check (role in ('admin','student')),
  must_change_password boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists exams (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  course text,
  duration_minutes int not null check (duration_minutes > 0),
  pass_mark numeric not null default 50,
  opens_at timestamptz,
  closes_at timestamptz,
  published boolean not null default false,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists questions (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references exams(id) on delete cascade,
  position int not null,
  question_text text not null,
  option_a text not null,
  option_b text not null,
  option_c text not null,
  option_d text not null,
  created_at timestamptz not null default now()
);

-- Correct answers live in their own table so students can never read them
create table if not exists answer_keys (
  question_id uuid primary key references questions(id) on delete cascade,
  correct_option text not null check (correct_option in ('A','B','C','D'))
);

create table if not exists attempts (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references exams(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  score int,
  total int,
  percentage numeric,
  violations int not null default 0,
  auto_submitted boolean not null default false,
  unique (exam_id, student_id)
);

create table if not exists attempt_answers (
  attempt_id uuid not null references attempts(id) on delete cascade,
  question_id uuid not null references questions(id) on delete cascade,
  selected_option text check (selected_option in ('A','B','C','D')),
  is_correct boolean,
  primary key (attempt_id, question_id)
);

-- ---------- 2. HELPER: is the current user an admin? ----------
create or replace function is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

-- ---------- 3. ROW LEVEL SECURITY ----------
alter table profiles enable row level security;
alter table exams enable row level security;
alter table questions enable row level security;
alter table answer_keys enable row level security;
alter table attempts enable row level security;
alter table attempt_answers enable row level security;

-- profiles
create policy "admin manages profiles" on profiles for all
  using (is_admin()) with check (is_admin());
create policy "user reads own profile" on profiles for select
  using (id = auth.uid());

-- exams
create policy "admin manages exams" on exams for all
  using (is_admin()) with check (is_admin());
create policy "students read published exams" on exams for select
  using (published);

-- questions (students can read questions of published exams, never answers)
create policy "admin manages questions" on questions for all
  using (is_admin()) with check (is_admin());
create policy "students read questions of published exams" on questions for select
  using (exists (select 1 from exams e where e.id = questions.exam_id and e.published));

-- answer keys: admin only
create policy "admin manages answer keys" on answer_keys for all
  using (is_admin()) with check (is_admin());

-- attempts: students see only their own; creation/submission happens through functions
create policy "admin manages attempts" on attempts for all
  using (is_admin()) with check (is_admin());
create policy "student reads own attempts" on attempts for select
  using (student_id = auth.uid());

-- attempt answers: admin only
create policy "admin reads attempt answers" on attempt_answers for all
  using (is_admin()) with check (is_admin());

-- ---------- 4. FUNCTIONS (server-side logic) ----------

-- Start (or resume) an exam. Checks publish state and time window.
create or replace function start_exam(p_exam_id uuid)
returns attempts
language plpgsql security definer set search_path = public
as $$
declare
  e exams;
  a attempts;
begin
  select * into e from exams where id = p_exam_id and published;
  if not found then raise exception 'This exam is not available.'; end if;
  if e.opens_at is not null and now() < e.opens_at then
    raise exception 'This exam has not opened yet.';
  end if;

  select * into a from attempts where exam_id = p_exam_id and student_id = auth.uid();
  if found then
    if a.submitted_at is not null then raise exception 'You already submitted this exam.'; end if;
    return a;                                   -- resume the same attempt
  end if;

  if e.closes_at is not null and now() > e.closes_at then
    raise exception 'The exam window has closed.';
  end if;

  insert into attempts (exam_id, student_id) values (p_exam_id, auth.uid())
  returning * into a;
  return a;
end $$;

-- Submit and grade on the server.
create or replace function submit_exam(
  p_exam_id uuid,
  p_answers jsonb,
  p_violations int default 0,
  p_auto boolean default false
)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  a attempts;
  q record;
  sel text;
  v_score int := 0;
  v_total int := 0;
  v_pct numeric;
begin
  select * into a from attempts
   where exam_id = p_exam_id and student_id = auth.uid() for update;
  if not found then raise exception 'You have not started this exam.'; end if;
  if a.submitted_at is not null then raise exception 'You already submitted this exam.'; end if;

  for q in
    select qs.id as qid, ak.correct_option
    from questions qs
    join answer_keys ak on ak.question_id = qs.id
    where qs.exam_id = p_exam_id
  loop
    sel := upper(p_answers ->> (q.qid::text));
    if sel not in ('A','B','C','D') then sel := null; end if;
    v_total := v_total + 1;
    if sel = q.correct_option then v_score := v_score + 1; end if;
    insert into attempt_answers (attempt_id, question_id, selected_option, is_correct)
    values (a.id, q.qid, sel, sel = q.correct_option);
  end loop;

  v_pct := case when v_total > 0 then round(v_score * 100.0 / v_total, 2) else 0 end;

  update attempts
     set submitted_at = now(), score = v_score, total = v_total, percentage = v_pct,
         violations = p_violations, auto_submitted = p_auto
   where id = a.id;

  return json_build_object('score', v_score, 'total', v_total, 'percentage', v_pct);
end $$;

-- Called after a student changes their first password.
create or replace function finish_password_change()
returns void
language sql security definer set search_path = public
as $$
  update profiles set must_change_password = false where id = auth.uid();
$$;

-- ---------- 5. CREATE THE ADMIN ACCOUNT (run after creating the user, see README) ----------
-- Example (edit the email):
-- insert into profiles (id, username, full_name, role, must_change_password)
-- select id, 'admin', 'System Administrator', 'admin', false
--   from auth.users where email = 'admin@yourschool.edu'
-- on conflict (id) do update set role = 'admin';
