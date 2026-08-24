create table domain_events (
  event_id uuid primary key default gen_random_uuid(),
  event_sequence bigint generated always as identity unique,
  event_type text not null,
  payload_version integer not null,
  aggregate_type text not null,
  aggregate_id text not null,
  payload jsonb not null,
  occurred_at timestamptz not null default now(),
  next_attempt_at timestamptz not null default now(),
  claim_token uuid,
  claim_expires_at timestamptz,
  publish_attempts integer not null default 0,
  last_failure_category text,
  last_failure_at timestamptz,
  published_at timestamptz,
  constraint domain_events_payload_version_check check (payload_version > 0),
  constraint domain_events_publish_attempts_check check (publish_attempts >= 0),
  constraint domain_events_payload_object_check check (jsonb_typeof(payload) = 'object'),
  constraint domain_events_event_type_check check (event_type <> ''),
  constraint domain_events_aggregate_identity_check
    check (aggregate_type <> '' and aggregate_id <> ''),
  constraint domain_events_claim_pair_check
    check ((claim_token is null) = (claim_expires_at is null)),
  constraint domain_events_failure_pair_check
    check ((last_failure_category is null) = (last_failure_at is null)),
  constraint domain_events_failure_category_check
    check (
      last_failure_category is null
      or last_failure_category in (
        'queue-unavailable',
        'queue-rejected',
        'invalid-event',
        'unknown'
      )
    ),
  constraint domain_events_published_claim_check
    check (published_at is null or claim_token is null)
);

create index domain_events_pending_unclaimed_idx
  on domain_events (next_attempt_at, event_sequence)
  where published_at is null and claim_token is null;

create index domain_events_pending_expired_claim_idx
  on domain_events (claim_expires_at, event_sequence)
  where published_at is null and claim_token is not null;

create index domain_events_published_retention_idx
  on domain_events (published_at)
  where published_at is not null;

create function prevent_domain_event_envelope_update()
returns trigger
language plpgsql
as $$
begin
  if row(
    old.event_id,
    old.event_sequence,
    old.event_type,
    old.payload_version,
    old.aggregate_type,
    old.aggregate_id,
    old.payload,
    old.occurred_at
  ) is distinct from row(
    new.event_id,
    new.event_sequence,
    new.event_type,
    new.payload_version,
    new.aggregate_type,
    new.aggregate_id,
    new.payload,
    new.occurred_at
  ) then
    raise exception 'domain event envelope is immutable';
  end if;

  return new;
end;
$$;

create trigger domain_events_immutable_envelope
before update on domain_events
for each row execute function prevent_domain_event_envelope_update();
