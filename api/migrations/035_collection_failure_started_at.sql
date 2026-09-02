alter table platform_collection_state
  add column failure_started_at timestamptz;

update platform_collection_state
set failure_started_at = updated_at
where last_failure_class is not null;

alter table platform_collection_state
  add constraint platform_collection_state_failure_started_at_check
  check (
    (last_failure_class is null and failure_started_at is null)
    or (last_failure_class is not null and failure_started_at is not null)
  );
