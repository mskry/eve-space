alter table domain_events add column pending_since timestamptz;

update domain_events
set pending_since = occurred_at
where pending_since is null;

alter table domain_events
  alter column pending_since set default now(),
  alter column pending_since set not null;

drop index domain_events_pending_unclaimed_idx;
drop index domain_events_pending_expired_claim_idx;

create index domain_events_pending_eligible_idx
  on domain_events (next_attempt_at, event_sequence)
  where published_at is null;
