-- A single, initially unchecked email choice covers both optional categories.
-- Existing choices, unsubscribe records and older open forms remain valid.
begin;
do $$
declare definition text; function_name text;
begin
  select pg_get_functiondef('public.submit_waitlist(jsonb,text)'::regprocedure) into definition;
  if position($expected$or p_payload->>'emailPreferencesVersion' is distinct from '2026-10-17'$expected$ in definition)=0 then
    raise exception 'Apply migrations 001 through 004 first';
  end if;
  definition=replace(definition,
    $old$('2026-10-17-dual-analytics','2026-10-17-email','2026-10-17-thank-you')$old$,
    $new$('2026-10-17-dual-analytics','2026-10-17-email','2026-10-17-thank-you','2026-10-17-combined-updates')$new$);
  definition=replace(definition,
    $old$or p_payload->>'emailPreferencesVersion' is distinct from '2026-10-17'$old$,
    $new$or coalesce(p_payload->>'emailPreferencesVersion','') not in ('2026-10-17','2026-10-17-combined-opt-in')
     or ((p_payload->>'privacyVersion'='2026-10-17-combined-updates') is distinct from (p_payload->>'emailPreferencesVersion'='2026-10-17-combined-opt-in'))
     or (p_payload->>'emailPreferencesVersion'='2026-10-17-combined-opt-in' and
       p_payload#>'{emailPreferences,newsletter}' is distinct from p_payload#>'{emailPreferences,marketing}')$new$);
  execute definition;
  foreach function_name in array array['private.apply_waitlist_form_preferences()','private.queue_waitlist_email()'] loop
    select pg_get_functiondef(function_name::regprocedure) into definition;
    if position($expected$'2026-10-17-email','2026-10-17-thank-you'$expected$ in definition)=0 then
      raise exception 'Unexpected email trigger definition';
    end if;
    execute replace(definition,
      $old$'2026-10-17-email','2026-10-17-thank-you'$old$,
      $new$'2026-10-17-email','2026-10-17-thank-you','2026-10-17-combined-updates'$new$);
  end loop;
end;
$$;
commit;
