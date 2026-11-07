-- Test for migration 0031. Runs as signed-in users would through the API,
-- inside one transaction that is rolled back, so it leaves nothing behind.
-- Any failed check raises an exception:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/0031_copilot_features.sql

begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000311', 'me-0031@example.test'),
  ('00000000-0000-4000-8000-000000000312', 'other-0031@example.test');

-- Rows only the server (service role) creates.
set local role service_role;
-- A support ticket opened through /api/support, with a reply from support.
insert into public.support_tickets (id, user_id, email, subject, description, category)
  values ('00000000-0000-4000-8000-0000000003c1', '00000000-0000-4000-8000-000000000311',
          'me-0031@example.test', 'Audio drops', 'The transcript stops after a minute.', 'technical');
insert into public.support_messages (ticket_id, user_id, is_from_admin, content)
  values ('00000000-0000-4000-8000-0000000003c1', null, true, 'Thanks, we are looking into it.');
-- A live session and a fact learned from it.
insert into public.copilot_sessions (id, user_id, status)
  values ('00000000-0000-4000-8000-0000000003d1', '00000000-0000-4000-8000-000000000311', 'stopped');
insert into public.memories (id, user_id, content, source, source_session_id)
  values ('00000000-0000-4000-8000-0000000003e1', '00000000-0000-4000-8000-000000000311',
          'Led a payments migration that cut checkout latency by 40%.', 'session', '00000000-0000-4000-8000-0000000003d1');
reset role;

-- The other user's things, made as them.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000312","role":"authenticated"}', true);
set local role authenticated;
insert into public.resume_documents (id, user_id, filename)
  values ('00000000-0000-4000-8000-0000000003f2', '00000000-0000-4000-8000-000000000312', 'other.pdf');
insert into public.playbooks (id, user_id, name, instructions)
  values ('00000000-0000-4000-8000-0000000003a2', '00000000-0000-4000-8000-000000000312', 'Theirs', 'Be brief.');
insert into public.materials (id, user_id, title, content)
  values ('00000000-0000-4000-8000-0000000003b2', '00000000-0000-4000-8000-000000000312', 'Their notes', 'Private notes.');
insert into public.goals (id, user_id, name)
  values ('00000000-0000-4000-8000-000000000392', '00000000-0000-4000-8000-000000000312', 'Their goal');
-- They share one question for Acme and keep one private.
insert into public.company_questions (user_id, company, question_text, question_type, source, shared) values
  ('00000000-0000-4000-8000-000000000312', 'acme', 'Tell me about a time you disagreed with your manager.', 'behavioral', 'reported', true),
  ('00000000-0000-4000-8000-000000000312', 'Acme', 'Design a rate limiter for our public API.', 'technical', 'reported', false);
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000311","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  me constant uuid := '00000000-0000-4000-8000-000000000311';
  other constant uuid := '00000000-0000-4000-8000-000000000312';
  ticket constant uuid := '00000000-0000-4000-8000-0000000003c1';
  my_resume constant uuid := '00000000-0000-4000-8000-0000000003f1';
  my_playbook constant uuid := '00000000-0000-4000-8000-0000000003a1';
  my_material constant uuid := '00000000-0000-4000-8000-0000000003b1';
  my_goal constant uuid := '00000000-0000-4000-8000-000000000391';
  n int;
  flag boolean;
begin
  -- 1. Support: read your own ticket and its replies; never write them directly.
  select count(*) into n from public.support_tickets where id = ticket;
  if n <> 1 then raise exception 'FAIL: the user cannot read their own ticket'; end if;
  select count(*) into n from public.support_messages where ticket_id = ticket;
  if n <> 1 then raise exception 'FAIL: the user cannot read the reply to their ticket'; end if;
  begin
    insert into public.support_tickets (user_id, email, subject, description, category, priority)
      values (me, 'me-0031@example.test', 'Urgent!', 'Jump the queue', 'other', 'urgent');
    raise exception 'FAIL: a user opened a ticket directly';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.support_tickets set priority = 'urgent', status = 'resolved' where id = ticket;
    raise exception 'FAIL: a user changed their ticket''s priority or status';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.support_messages (ticket_id, user_id, is_from_admin, content)
      values (ticket, me, true, 'Posing as support');
    raise exception 'FAIL: a user posted a message directly';
  exception when insufficient_privilege then null;
  end;

  -- 2. Goals, playbooks and materials: your own, pointing only at your own things.
  insert into public.resume_documents (id, user_id, filename) values (my_resume, me, 'mine.pdf');
  insert into public.playbooks (id, user_id, name, instructions) values (my_playbook, me, 'Mine', 'Lead with the result.');
  insert into public.materials (id, user_id, title, kind, content)
    values (my_material, me, 'Payments project', 'project', 'Migrated checkout to a new payments provider.');
  insert into public.goals (id, user_id, name, company, role, round, resume_document_id, playbook_id, job_description)
    values (my_goal, me, 'Acme staff engineer', 'Acme', 'Staff Engineer', 'system_design', my_resume, my_playbook, 'Own the platform.');
  insert into public.goal_materials (goal_id, material_id, user_id) values (my_goal, my_material, me);
  begin
    insert into public.goals (user_id, name, resume_document_id) values (me, 'Borrowed résumé', '00000000-0000-4000-8000-0000000003f2');
    raise exception 'FAIL: a goal used another user''s résumé';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.goals set playbook_id = '00000000-0000-4000-8000-0000000003a2' where id = my_goal;
    raise exception 'FAIL: a goal used another user''s playbook';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.goal_materials (goal_id, material_id, user_id) values (my_goal, '00000000-0000-4000-8000-0000000003b2', me);
    raise exception 'FAIL: a goal linked another user''s material';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.goals (user_id, name, round) values (me, 'Odd round', 'lunch');
    raise exception 'FAIL: an unknown interview round was accepted';
  exception when check_violation then null;
  end;
  select count(*) into n from public.goals where user_id = other;
  if n <> 0 then raise exception 'FAIL: the user sees another user''s goals'; end if;
  select count(*) into n from public.materials where user_id = other;
  if n <> 0 then raise exception 'FAIL: the user sees another user''s materials'; end if;
  select count(*) into n from public.playbooks where user_id = other;
  if n <> 0 then raise exception 'FAIL: the user sees another user''s playbooks'; end if;

  -- 3. Memory: add facts by hand, read and delete learned ones, never forge them.
  insert into public.memories (user_id, goal_id, content) values (me, my_goal, 'Prefers to answer system design top-down.');
  select count(*) into n from public.memories where user_id = me;
  if n <> 2 then raise exception 'FAIL: the user sees % of their 2 memories', n; end if;
  begin
    insert into public.memories (user_id, content, source) values (me, 'A forged learned fact.', 'session');
    raise exception 'FAIL: a user wrote a memory as if learned from a session';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.memories (user_id, goal_id, content) values (me, '00000000-0000-4000-8000-000000000392', 'On their goal.');
    raise exception 'FAIL: a memory was attached to another user''s goal';
  exception when insufficient_privilege then null;
  end;
  delete from public.memories where id = '00000000-0000-4000-8000-0000000003e1';
  select count(*) into n from public.memories where source = 'session';
  if n <> 0 then raise exception 'FAIL: the user could not delete a learned memory'; end if;

  -- "Learn from my live sessions" can be switched off.
  update public.profiles set memory_enabled = false where id = me;
  select memory_enabled into flag from public.profiles where id = me;
  if flag is distinct from false then raise exception 'FAIL: memory_enabled was not saved'; end if;

  -- 4. Company questions: your own rows directly; the shared bank only through the functions.
  insert into public.company_questions (user_id, company, question_text, question_type, source, shared) values
    (me, ' ACME ', 'Tell me about a time you disagreed with your manager.', 'behavioral', 'practice', true),
    (me, 'Acme', 'Why do you want to work here?', 'general', 'practice', false);
  begin
    insert into public.company_questions (user_id, company, question_text)
      values (me, 'acme', 'WHY DO YOU WANT TO WORK HERE?');
    raise exception 'FAIL: the same question was saved twice for one company';
  exception when unique_violation then null;
  end;
  select count(*) into n from public.company_questions where user_id = other;
  if n <> 0 then raise exception 'FAIL: the user reads another user''s questions directly'; end if;

  -- Shared by two people (different spelling of the company) → one row with 2 reports;
  -- the other user's private question and my private question stay out.
  select count(*) into n from public.company_question_bank('acme');
  if n <> 1 then raise exception 'FAIL: the Acme bank has % rows, expected 1', n; end if;
  select reports into n from public.company_question_bank('  Acme');
  if n <> 2 then raise exception 'FAIL: the shared question shows % reports, expected 2', n; end if;
  select questions into n from public.company_question_companies('acm');
  if n <> 1 then raise exception 'FAIL: company search counts % questions for Acme, expected 1', n; end if;
  -- LIKE wildcards and the escape character in a search are plain text.
  select count(*) into n from public.company_question_companies('%');
  if n <> 0 then raise exception 'FAIL: a %% search matched every company'; end if;
  select count(*) into n from public.company_question_companies('_cme');
  if n <> 0 then raise exception 'FAIL: an _ search acted as a wildcard'; end if;
  -- Unescaped, 'a\cme' would read as a, literal c, me and match Acme.
  select count(*) into n from public.company_question_companies('a\cme');
  if n <> 0 then raise exception 'FAIL: a backslash in a search escaped the next letter'; end if;
  select count(*) into n from public.company_question_companies('acme\');
  if n <> 0 then raise exception 'FAIL: a trailing backslash matched a company'; end if;
end;
$$;

-- 5. Signed-out visitors can't read the shared bank.
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $$
begin
  begin
    perform * from public.company_question_bank('acme');
    raise exception 'FAIL: a signed-out visitor read the question bank';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.company_question_companies(null);
    raise exception 'FAIL: a signed-out visitor listed the question bank companies';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: 0031 copilot_features';
end;
$$;

rollback;
