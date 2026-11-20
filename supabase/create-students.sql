-- ============================================================
-- SQL: Role-based Student Account Creation & Management
-- Run this ONCE in Supabase → SQL Editor → New query → Run
-- Enables database-side role-based student creation & deletion
-- for any organization (supports custom IDs like RU0204/16).
-- ============================================================

create extension if not exists pgcrypto;

-- Function to create a single student account directly in auth.users & profiles
create or replace function create_student_account(
  p_username text,
  p_password text,
  p_full_name text default null,
  p_role text default 'student'
)
returns uuid
language plpgsql security definer set search_path = public, auth, extensions
as $$
declare
  v_user_id uuid;
  v_email text;
  v_domain text := 'students.examportal.app';
  v_clean_username text;
  v_role text := coalesce(nullif(trim(p_role), ''), 'student');
begin
  -- Role-based check: Caller must have admin role
  if not is_admin() then
    raise exception 'Access denied: Admin role required.';
  end if;

  v_clean_username := trim(p_username);
  if length(v_clean_username) < 2 then
    raise exception 'Username is too short.';
  end if;

  if v_role not in ('student', 'admin') then
    raise exception 'Invalid role: %', v_role;
  end if;

  -- Verify unique username in profiles (case-insensitive)
  if exists (select 1 from profiles where lower(username) = lower(v_clean_username)) then
    raise exception 'Student ID "%" already exists.', v_clean_username;
  end if;

  v_email := lower(v_clean_username) || '@' || v_domain;
  v_user_id := gen_random_uuid();

  -- 1. Insert into auth.users with encrypted password
  insert into auth.users (
    id, instance_id, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, role, aud, created_at, updated_at
  ) values (
    v_user_id, '00000000-0000-0000-0000-000000000000', v_email,
    crypt(p_password, gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('username', v_clean_username, 'full_name', p_full_name, 'role', v_role),
    'authenticated', 'authenticated', now(), now()
  );

  -- 2. Insert into profiles with role and must_change_password = true
  insert into profiles (id, username, full_name, role, must_change_password)
  values (v_user_id, v_clean_username, p_full_name, v_role, true);

  return v_user_id;
end $$;

-- Batch function to create multiple students directly in the database
create or replace function create_students_batch(
  p_students jsonb
)
returns jsonb
language plpgsql security definer set search_path = public, auth, extensions
as $$
declare
  item jsonb;
  v_username text;
  v_password text;
  v_fullname text;
  v_role text;
  v_uid uuid;
  results jsonb := '[]'::jsonb;
begin
  if not is_admin() then
    raise exception 'Access denied: Admin role required.';
  end if;

  for item in select * from jsonb_array_elements(p_students) loop
    v_username := trim(item->>'username');
    v_password := trim(item->>'password');
    v_fullname := nullif(trim(item->>'full_name'), '');
    v_role     := coalesce(nullif(trim(item->>'role'), ''), 'student');

    begin
      v_uid := create_student_account(v_username, v_password, v_fullname, v_role);
      results := results || jsonb_build_object('username', v_username, 'ok', true, 'id', v_uid);
    exception when others then
      results := results || jsonb_build_object('username', v_username, 'ok', false, 'error', SQLERRM);
    end;
  end loop;

  return results;
end $$;

-- Function to permanently delete student accounts
create or replace function delete_student_accounts(p_usernames text[])
returns text[]
language plpgsql security definer set search_path = public, auth
as $$
declare
  u text;
  v_id uuid;
  deleted text[] := array[]::text[];
begin
  if not is_admin() then
    raise exception 'Access denied: Admin role required.';
  end if;

  foreach u in array p_usernames loop
    select id into v_id from profiles where lower(username) = lower(trim(u)) and role = 'student';
    if found then
      delete from auth.users where id = v_id;
      delete from profiles where id = v_id;
      deleted := array_append(deleted, u);
    end if;
  end loop;

  return deleted;
end $$;
