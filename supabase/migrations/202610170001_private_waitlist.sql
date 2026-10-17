-- Run once in a NEW Supabase project using SQL Editor, or apply with Supabase CLI.
-- The retired schema in archive/legacy is not a prerequisite.
begin;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.waitlist_signups (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  full_name text not null check (length(full_name) between 1 and 160),
  country_from text not null default '' check (length(country_from) <= 80),
  feature_wish text not null check (length(feature_wish) between 3 and 1000),
  adult_confirmed boolean not null check (adult_confirmed),
  terms_accepted boolean not null check (terms_accepted),
  privacy_acknowledged boolean not null check (privacy_acknowledged),
  newsletter_requested boolean not null,
  marketing_requested boolean not null,
  newsletter_status text not null check (newsletter_status in ('not_requested', 'pending', 'verified', 'unsubscribed')),
  marketing_status text not null check (marketing_status in ('not_requested', 'pending', 'verified', 'unsubscribed')),
  privacy_version text not null,
  terms_version text not null,
  preferences_version text not null,
  created_at timestamptz not null default now(),
  last_interaction_at timestamptz not null default now()
);
create table private.waitlist_requests (
  request_id uuid primary key,
  signup_id uuid not null references private.waitlist_signups(id) on delete cascade,
  payload_hash text not null,
  -- Duplicate submissions are unverified requests, never an instruction to resubscribe.
  submission jsonb not null,
  receipt_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);
create table private.waitlist_rate_limits (
  rate_key text not null,
  bucket bigint not null,
  attempts integer not null,
  primary key (rate_key, bucket)
);
alter table private.waitlist_signups enable row level security;
alter table private.waitlist_requests enable row level security;
alter table private.waitlist_rate_limits enable row level security;
revoke all on all tables in schema private from public, anon, authenticated;

create function public.submit_waitlist(p_payload jsonb, p_rate_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  request_uuid uuid;
  fingerprint text := encode(sha256(convert_to(p_payload::text, 'UTF8')), 'hex');
  request_row private.waitlist_requests%rowtype;
  signup_uuid uuid;
  attempts_count integer;
  current_bucket bigint := floor(extract(epoch from now()) / 600)::bigint;
begin
  -- Defense in depth if a future server caller bypasses its input validator.
  if p_payload->>'version' is distinct from '4'
     or p_payload->>'privacyVersion' is distinct from '2026-10-17-analytics'
     or p_payload->>'termsVersion' is distinct from '2026-10-17'
     or p_payload->>'emailPreferencesVersion' is distinct from '2026-10-17'
     or p_payload->'adultConfirmed' is distinct from 'true'::jsonb
     or p_payload->'termsAccepted' is distinct from 'true'::jsonb
     or p_payload->'privacyAcknowledged' is distinct from 'true'::jsonb
     or jsonb_typeof(p_payload#>'{emailPreferences,newsletter}') is distinct from 'boolean'
     or jsonb_typeof(p_payload#>'{emailPreferences,marketing}') is distinct from 'boolean'
     or coalesce(p_payload->>'requestId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or coalesce(p_rate_key,'') !~ '^[0-9a-f]{64}$'
     or length(coalesce(p_payload->>'fullName','')) not between 1 and 160
     or length(coalesce(p_payload->>'featureWish','')) not between 3 and 1000
     or length(coalesce(p_payload->>'countryFrom','')) > 80
     or length(coalesce(p_payload->>'email','')) > 254
     or coalesce(p_payload->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  then raise exception 'Invalid waitlist contract' using errcode = '22023'; end if;
  request_uuid := (p_payload->>'requestId')::uuid;
  -- Serialize retries for this request across function instances.
  perform pg_advisory_xact_lock(hashtextextended(request_uuid::text, 0));
  select * into request_row from private.waitlist_requests where request_id = request_uuid;
  if found then
    if request_row.payload_hash <> fingerprint then return jsonb_build_object('error','request_conflict'); end if;
    return jsonb_build_object('version',4,'acknowledged',true,'receipt',jsonb_build_object('id',request_row.receipt_id,'saved',true,'preferencesSaved',true,'emailStatus','pending'));
  end if;
  insert into private.waitlist_rate_limits values (p_rate_key, current_bucket, 1)
    on conflict (rate_key,bucket) do update set attempts = private.waitlist_rate_limits.attempts + 1
    returning attempts into attempts_count;
  if attempts_count > 10 then return jsonb_build_object('error','rate_limit'); end if;
  delete from private.waitlist_rate_limits where bucket < current_bucket - 144;
  insert into private.waitlist_signups (email,full_name,country_from,feature_wish,adult_confirmed,terms_accepted,privacy_acknowledged,newsletter_requested,marketing_requested,newsletter_status,marketing_status,privacy_version,terms_version,preferences_version)
  values (lower(trim(p_payload->>'email')),p_payload->>'fullName',coalesce(p_payload->>'countryFrom',''),p_payload->>'featureWish',true,true,true,(p_payload#>>'{emailPreferences,newsletter}')::boolean,(p_payload#>>'{emailPreferences,marketing}')::boolean,
    case when (p_payload#>>'{emailPreferences,newsletter}')::boolean then 'pending' else 'not_requested' end,
    case when (p_payload#>>'{emailPreferences,marketing}')::boolean then 'pending' else 'not_requested' end,
    p_payload->>'privacyVersion',p_payload->>'termsVersion',p_payload->>'emailPreferencesVersion')
  on conflict (email) do nothing returning id into signup_uuid;
  if signup_uuid is null then select id into signup_uuid from private.waitlist_signups where email = lower(trim(p_payload->>'email')); end if;
  insert into private.waitlist_requests (request_id,signup_id,payload_hash,submission) values (request_uuid,signup_uuid,fingerprint,p_payload) returning * into request_row;
  return jsonb_build_object('version',4,'acknowledged',true,'receipt',jsonb_build_object('id',request_row.receipt_id,'saved',true,'preferencesSaved',true,'emailStatus','pending'));
end;
$$;
revoke all on function public.submit_waitlist(jsonb,text) from public, anon, authenticated;
grant execute on function public.submit_waitlist(jsonb,text) to service_role;
commit;
