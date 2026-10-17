-- Apply after the two existing migrations. Existing signups are not emailed.
begin;
alter table private.waitlist_signups
  add column email_verified_at timestamptz,
  add column email_suppressed_at timestamptz;

create table private.waitlist_email_outbox (
  id uuid primary key default gen_random_uuid(),
  signup_id uuid not null unique references private.waitlist_signups(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '48 hours',
  first_attempt_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  attempts integer not null default 0,
  provider_id uuid unique,
  sent_at timestamptz,
  confirmed_at timestamptz,
  stopped_at timestamptz,
  delivery_status text not null default 'queued'
    check (delivery_status in ('queued','sent','delivered','delayed','failed','bounced','complained','suppressed'))
);
create table private.waitlist_email_events (
  id text primary key,
  signup_id uuid not null references private.waitlist_signups(id) on delete cascade,
  kind text not null,
  created_at timestamptz not null default now()
);
alter table private.waitlist_email_outbox enable row level security;
alter table private.waitlist_email_events enable row level security;
revoke all on private.waitlist_email_outbox, private.waitlist_email_events from public, anon, authenticated;

create function private.queue_waitlist_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Only this new notice promises this flow. No automatic backfill or test mail.
  if new.privacy_version = '2026-10-17-email'
     and new.email !~* '@[^@]*[.]test$'
  then insert into private.waitlist_email_outbox(signup_id) values(new.id); end if;
  return new;
end;
$$;
revoke all on function private.queue_waitlist_email() from public, anon, authenticated;
create trigger queue_waitlist_email after insert on private.waitlist_signups
for each row execute function private.queue_waitlist_email();

-- Preserve all validation and atomic signup behavior from migration 002.
do $$
declare definition text;
begin
  select pg_get_functiondef('public.submit_waitlist(jsonb,text)'::regprocedure) into definition;
  if position('2026-10-17-dual-analytics' in definition) = 0 then
    raise exception 'Apply migration 002 first';
  end if;
  -- Keep the prior notice valid during deployment/rollback. Only new-notice rows queue mail.
  execute replace(definition,
    $old$p_payload->>'privacyVersion' is distinct from '2026-10-17-dual-analytics'$old$,
    $new$coalesce(p_payload->>'privacyVersion','') not in ('2026-10-17-dual-analytics','2026-10-17-email')$new$);
end;
$$;

create function public.claim_waitlist_emails() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  -- Never retry an uncertain send beyond Resend's 24-hour idempotency window.
  update private.waitlist_email_outbox set stopped_at=now(), delivery_status='failed'
  where sent_at is null and stopped_at is null
    and (expires_at <= now() or first_attempt_at < now()-interval '20 hours' or attempts >= 12);
  with candidates as (
    select o.id from private.waitlist_email_outbox o
    join private.waitlist_signups s on s.id=o.signup_id
    where o.sent_at is null and o.stopped_at is null and s.email_suppressed_at is null
      and o.next_attempt_at <= now() and (o.lease_until is null or o.lease_until < now())
    order by o.created_at limit 1 for update of o skip locked
  ), claimed as (
    update private.waitlist_email_outbox o
    set attempts=attempts+1, first_attempt_at=coalesce(first_attempt_at,now()),
        lease_until=now()+interval '2 minutes', next_attempt_at=now()+interval '5 minutes'
    from candidates c where o.id=c.id returning o.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',o.id,'signupId',s.id,'email',s.email,
    'newsletter',s.newsletter_requested,'marketing',s.marketing_requested)), '[]'::jsonb)
  into result from claimed o join private.waitlist_signups s on s.id=o.signup_id;
  return result;
end;
$$;

create function public.finish_waitlist_email(p_id uuid, p_provider_id uuid, p_permanent_failure boolean default false)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update private.waitlist_email_outbox
    set provider_id=coalesce(provider_id,p_provider_id),
        sent_at=case when p_provider_id is not null then coalesce(sent_at,now()) else sent_at end,
        delivery_status=case when p_provider_id is not null and delivery_status='queued' then 'sent'
          when p_permanent_failure then 'failed' else delivery_status end,
        stopped_at=case when p_permanent_failure then coalesce(stopped_at,now()) else stopped_at end,
        lease_until=null
    where id=p_id and (provider_id is null or provider_id=p_provider_id);
  return found;
end;
$$;

create function public.waitlist_email_action(p_id uuid, p_purpose text, p_action text, p_scope text default 'all')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s private.waitlist_signups%rowtype; o private.waitlist_email_outbox%rowtype;
begin
  if p_purpose not in ('confirm','unsubscribe') or p_action not in ('preview','confirm','unsubscribe')
     or p_scope not in ('all','newsletter','marketing') then
    return jsonb_build_object('error','invalid_link');
  end if;
  if p_purpose='confirm' then
    select * into o from private.waitlist_email_outbox where id=p_id for update;
    if not found or o.expires_at <= now() or o.sent_at is null then
      return jsonb_build_object('error','expired_link');
    end if;
    select * into s from private.waitlist_signups where id=o.signup_id for update;
  else
    select * into s from private.waitlist_signups where id=p_id for update;
  end if;
  if s.id is null then return jsonb_build_object('error','invalid_link'); end if;
  if p_action='confirm' then
    if p_purpose <> 'confirm' then return jsonb_build_object('error','invalid_link'); end if;
    if s.email_suppressed_at is not null then return jsonb_build_object('error','email_stopped'); end if;
    if o.confirmed_at is null then
      update private.waitlist_signups set email_verified_at=coalesce(email_verified_at,now()),
        newsletter_status=case when newsletter_requested and newsletter_status='pending' then 'verified' else newsletter_status end,
        marketing_status=case when marketing_requested and marketing_status='pending' then 'verified' else marketing_status end,
        last_interaction_at=now() where id=s.id;
      update private.waitlist_email_outbox set confirmed_at=now() where id=o.id;
      insert into private.waitlist_email_events(id,signup_id,kind) values ('confirm:'||o.id,s.id,'confirmed');
    end if;
    return jsonb_build_object('confirmed',true);
  elsif p_action='unsubscribe' then
    -- Both signed links can withdraw; neither can add an unrequested category.
    update private.waitlist_signups set
      newsletter_status=case when p_scope in ('all','newsletter') and newsletter_status<>'not_requested' then 'unsubscribed' else newsletter_status end,
      marketing_status=case when p_scope in ('all','marketing') and marketing_status<>'not_requested' then 'unsubscribed' else marketing_status end,
      last_interaction_at=now() where id=s.id;
    insert into private.waitlist_email_events(id,signup_id,kind)
      values ('unsubscribe:'||s.id||':'||p_scope,s.id,'unsubscribed_'||p_scope) on conflict do nothing;
    return jsonb_build_object('unsubscribed',true);
  end if;
  return jsonb_build_object('purpose',p_purpose,'newsletter',s.newsletter_requested,
    'marketing',s.marketing_requested,'confirmed',o.confirmed_at is not null,
    'newsletterStatus',s.newsletter_status,'marketingStatus',s.marketing_status,
    'suppressed',s.email_suppressed_at is not null);
end;
$$;

create function public.record_waitlist_email_event(p_event_id text, p_provider_id uuid, p_kind text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare o private.waitlist_email_outbox%rowtype;
begin
  if length(p_event_id) not between 1 and 200 or p_kind not in
    ('email.sent','email.delivered','email.delivery_delayed','email.failed','email.bounced','email.complained','email.suppressed')
  then return false; end if;
  select * into o from private.waitlist_email_outbox where provider_id=p_provider_id for update;
  -- An event may race the send acknowledgement. Returning false asks for retry.
  if not found then return false; end if;
  insert into private.waitlist_email_events(id,signup_id,kind) values(p_event_id,o.signup_id,p_kind)
    on conflict do nothing;
  if not found then return true; end if;
  if p_kind in ('email.bounced','email.complained','email.suppressed') then
    update private.waitlist_signups set email_suppressed_at=coalesce(email_suppressed_at,now()),
      newsletter_status=case when newsletter_status='not_requested' then newsletter_status else 'unsubscribed' end,
      marketing_status=case when marketing_status='not_requested' then marketing_status else 'unsubscribed' end
      where id=o.signup_id;
    update private.waitlist_email_outbox set stopped_at=coalesce(stopped_at,now()),
      delivery_status=substring(p_kind from 7) where id=o.id;
  elsif o.delivery_status not in ('bounced','complained','suppressed') then
    update private.waitlist_email_outbox set delivery_status=case
      when p_kind='email.delivered' then 'delivered'
      when p_kind='email.delivery_delayed' and delivery_status<>'delivered' then 'delayed'
      when p_kind='email.failed' and delivery_status<>'delivered' then 'failed'
      else delivery_status end where id=o.id;
  end if;
  return true;
end;
$$;

-- Every new RPC is server-only. Browser visitors never read private tables.
revoke all on function public.claim_waitlist_emails() from public, anon, authenticated;
revoke all on function public.finish_waitlist_email(uuid,uuid,boolean) from public, anon, authenticated;
revoke all on function public.waitlist_email_action(uuid,text,text,text) from public, anon, authenticated;
revoke all on function public.record_waitlist_email_event(text,uuid,text) from public, anon, authenticated;
grant execute on function public.claim_waitlist_emails() to service_role;
grant execute on function public.finish_waitlist_email(uuid,uuid,boolean) to service_role;
grant execute on function public.waitlist_email_action(uuid,text,text,text) to service_role;
grant execute on function public.record_waitlist_email_event(text,uuid,text) to service_role;
commit;
