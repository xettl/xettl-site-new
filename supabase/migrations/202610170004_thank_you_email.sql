-- Replace email ownership confirmation with the owner's requested single opt-in flow.
begin;
alter table private.waitlist_signups drop constraint waitlist_signups_newsletter_status_check;
alter table private.waitlist_signups drop constraint waitlist_signups_marketing_status_check;
alter table private.waitlist_signups add constraint waitlist_signups_newsletter_status_check
  check(newsletter_status in ('not_requested','pending','verified','subscribed','unsubscribed'));
alter table private.waitlist_signups add constraint waitlist_signups_marketing_status_check
  check(marketing_status in ('not_requested','pending','verified','subscribed','unsubscribed'));

-- Form opt-in is subscription consent, not proof of email ownership. Do not set email_verified_at.
update private.waitlist_signups set
  newsletter_status=case when newsletter_requested and newsletter_status='pending' then 'subscribed' else newsletter_status end,
  marketing_status=case when marketing_requested and marketing_status='pending' then 'subscribed' else marketing_status end
where email_suppressed_at is null and (newsletter_status='pending' or marketing_status='pending');

create function private.apply_waitlist_form_preferences() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.privacy_version in ('2026-10-17-email','2026-10-17-thank-you') then
    new.newsletter_status=case when new.newsletter_requested then 'subscribed' else 'not_requested' end;
    new.marketing_status=case when new.marketing_requested then 'subscribed' else 'not_requested' end;
  end if;
  return new;
end;
$$;
revoke all on function private.apply_waitlist_form_preferences() from public,anon,authenticated;
create trigger apply_waitlist_form_preferences before insert on private.waitlist_signups
for each row execute function private.apply_waitlist_form_preferences();

alter table private.waitlist_email_outbox add column message_kind text not null default 'confirmation'
  check(message_kind in ('confirmation','thank_you'));
alter table private.waitlist_email_outbox alter column message_kind set default 'thank_you';
-- A never-attempted message can safely become a thank-you. Uncertain sends keep their old identity.
update private.waitlist_email_outbox set message_kind='thank_you'
where sent_at is null and first_attempt_at is null and stopped_at is null;
update private.waitlist_email_outbox set stopped_at=coalesce(stopped_at,now()),delivery_status='failed'
where message_kind='confirmation' and sent_at is null and stopped_at is null;

create or replace function private.queue_waitlist_email() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.privacy_version in ('2026-10-17-email','2026-10-17-thank-you')
     and new.email !~* '@[^@]*[.]test$'
  then insert into private.waitlist_email_outbox(signup_id,message_kind) values(new.id,'thank_you'); end if;
  return new;
end;
$$;

do $$
declare definition text;
begin
  select pg_get_functiondef('public.submit_waitlist(jsonb,text)'::regprocedure) into definition;
  execute replace(definition,
    $old$('2026-10-17-dual-analytics','2026-10-17-email')$old$,
    $new$('2026-10-17-dual-analytics','2026-10-17-email','2026-10-17-thank-you')$new$);
  select pg_get_functiondef('public.claim_waitlist_emails()'::regprocedure) into definition;
  definition=replace(definition,'public.claim_waitlist_emails()','public.claim_waitlist_thank_you_emails()');
  definition=replace(definition,'where o.sent_at is null', $filter$where o.message_kind='thank_you' and o.sent_at is null$filter$);
  definition=replace(definition,$old$'id',o.id,'signupId'$old$,$new$'kind',o.message_kind,'id',o.id,'signupId'$new$);
  execute definition;
end;
$$;
-- Old deployed workers cannot send confirmation messages during the deployment transition.
create or replace function public.claim_waitlist_emails() returns jsonb
language sql security definer set search_path='' as $$ select '[]'::jsonb; $$;
revoke all on function public.claim_waitlist_thank_you_emails() from public,anon,authenticated;
grant execute on function public.claim_waitlist_thank_you_emails() to service_role;

create or replace function public.waitlist_email_action(p_id uuid,p_purpose text,p_action text,p_scope text default 'all')
returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.waitlist_signups%rowtype;
begin
  if p_purpose='confirm' or p_action='confirm' then return jsonb_build_object('error','confirmation_removed'); end if;
  if coalesce(p_purpose,'')<>'unsubscribe' or coalesce(p_action,'') not in ('preview','unsubscribe')
    or coalesce(p_scope,'') not in ('all','newsletter','marketing') then return jsonb_build_object('error','invalid_link'); end if;
  select * into s from private.waitlist_signups where id=p_id for update;
  if not found then return jsonb_build_object('error','invalid_link'); end if;
  if p_action='unsubscribe' then
    update private.waitlist_signups set
      newsletter_status=case when p_scope in ('all','newsletter') and newsletter_status<>'not_requested' then 'unsubscribed' else newsletter_status end,
      marketing_status=case when p_scope in ('all','marketing') and marketing_status<>'not_requested' then 'unsubscribed' else marketing_status end,
      last_interaction_at=now() where id=s.id;
    insert into private.waitlist_email_events(id,signup_id,kind)
      values('unsubscribe:'||s.id||':'||p_scope,s.id,'unsubscribed_'||p_scope) on conflict do nothing;
    return jsonb_build_object('unsubscribed',true);
  end if;
  return jsonb_build_object('purpose','unsubscribe','newsletterStatus',s.newsletter_status,
    'marketingStatus',s.marketing_status,'suppressed',s.email_suppressed_at is not null);
end;
$$;
commit;
