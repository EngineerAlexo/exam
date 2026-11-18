-- ============================================================
-- ADD-ON: answer review after submission
-- Run this ONCE in Supabase → SQL Editor (after schema.sql)
-- Students can see correct answers ONLY after they submit.
-- ============================================================
create or replace function get_exam_review(p_exam_id uuid)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  a attempts;
  result json;
begin
  select * into a from attempts where exam_id = p_exam_id and student_id = auth.uid();
  if not found or a.submitted_at is null then
    raise exception 'Review is available after you submit the exam.';
  end if;

  select json_agg(x order by x.position) into result from (
    select q.id, q.position, q.question_text,
           q.option_a, q.option_b, q.option_c, q.option_d,
           ak.correct_option,
           aa.selected_option,
           aa.is_correct
      from questions q
      join answer_keys ak on ak.question_id = q.id
      left join attempt_answers aa on aa.question_id = q.id and aa.attempt_id = a.id
     where q.exam_id = p_exam_id
  ) x;

  return json_build_object(
    'score', a.score,
    'total', a.total,
    'percentage', a.percentage,
    'questions', coalesce(result, '[]'::json)
  );
end $$;
