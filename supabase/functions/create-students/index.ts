// ============================================================
// Edge Function: create-students
// Admin-only. Creates student accounts and resets passwords.
// The service-role key is available ONLY here, on the server.
// ============================================================
import { createClient } from 'jsr:@supabase/supabase-js@2';

// Must match STUDENT_EMAIL_DOMAIN in js/config.js
const STUDENT_EMAIL_DOMAIN = 'students.examportal.app';
const DEFAULT_STUDENT_PASSWORD = 'Student@123';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SERVICE_ROLE_KEY')!;

    // 1. Identify the caller from their own login token
    const caller = createClient(url, anonKey, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return reply({ error: 'Please sign in again.' }, 401);

    // 2. Only admins may continue
    const { data: me } = await caller.from('profiles').select('role').eq('id', user.id).maybeSingle();
    if (me?.role !== 'admin') return reply({ error: 'Admins only.' }, 403);

    // 3. Privileged client (server-side only)
    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const body = await req.json();

    // ----- reset a student's password -----
    if (body.action === 'reset') {
      const username = String(body.username ?? '').trim().toLowerCase();
      const password = String(body.password || DEFAULT_STUDENT_PASSWORD).trim();
      if (password.length < 8) return reply({ error: 'Password must be at least 8 characters.' }, 400);

      const { data: target } = await admin.from('profiles')
        .select('id').eq('username', username).maybeSingle();
      if (!target) return reply({ error: 'Student not found.' }, 404);

      const { error } = await admin.auth.admin.updateUserById(target.id, { password });
      if (error) return reply({ error: error.message }, 400);

      await admin.from('profiles').update({ must_change_password: true }).eq('id', target.id);
      return reply({ ok: true, password });
    }

    // ----- create many students -----
    const results: { username: string; ok: boolean; error?: string }[] = [];
    const list = (body.students ?? []) as { username: string; password?: string; full_name?: string }[];

    for (const s of list) {
      const username = String(s.username).trim().toLowerCase();
      const password = String(s.password || DEFAULT_STUDENT_PASSWORD).trim();

      const { data, error } = await admin.auth.admin.createUser({
        email: `${username}@${STUDENT_EMAIL_DOMAIN}`,
        password,
        email_confirm: true,
      });
      if (error || !data.user) {
        results.push({ username, ok: false, error: error?.message ?? 'Could not create user' });
        continue;
      }

      const { error: pErr } = await admin.from('profiles').insert({
        id: data.user.id,
        username,
        full_name: s.full_name || null,
        role: 'student',
        must_change_password: true,
      });
      if (pErr) {
        await admin.auth.admin.deleteUser(data.user.id);   // roll back the auth user
        results.push({ username, ok: false, error: pErr.message });
        continue;
      }
      results.push({ username, ok: true });
    }

    return reply({ results });
  } catch (err) {
    return reply({ error: String(err) }, 500);
  }
});
