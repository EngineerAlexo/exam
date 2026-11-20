-- ============================================================
-- SQL Helper: Delete student accounts completely
-- Run this ONCE in Supabase → SQL Editor → New query → Run
-- This allows admins to permanently delete students from BOTH
-- auth.users and public.profiles in one atomic operation.
-- ============================================================

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
      -- Deleting from auth.users cascades to public.profiles and attempts
      delete from auth.users where id = v_id;
      delete from profiles where id = v_id;
      deleted := array_append(deleted, u);
    end if;
  end loop;

  return deleted;
end $$;
