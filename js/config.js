// ============================================================
// CONFIG – the ONLY file you need to edit for your Supabase project
// The anon key is designed to be public (access is controlled by RLS).
// NEVER put the service_role key in any frontend file.
// ============================================================
const SUPABASE_URL = 'https://isjfzzktnyctzmhjqhju.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlzamZ6emt0bnljdHptaGpxaGp1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ5NzYyOTgsImV4cCI6MjExMDU1MjI5OH0.1nwXPVu2Ha1WaV2ZqOSqzL5ZF7476t3RTKcJt8qp0Us';

// Fake email domain used behind student usernames (username@this-domain).
// Must match STUDENT_EMAIL_DOMAIN in supabase/functions/create-students/index.ts
const STUDENT_EMAIL_DOMAIN = 'students.examportal.app';

// Warnings (leaving full-screen / switching tabs) before the exam auto-submits
const EXAM_MAX_VIOLATIONS = 3;
