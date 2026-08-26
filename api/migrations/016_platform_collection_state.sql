create table platform_collection_state (
  module_id text not null,
  resource_id text not null,
  subject_kind text not null,
  subject_lifecycle_id uuid not null,
  subject_id text not null,
  next_eligible_at timestamptz,
  authorization_generation integer,
  validated_at timestamptz,
  last_failure_class text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (
    module_id,
    resource_id,
    subject_kind,
    subject_lifecycle_id,
    subject_id
  ),
  constraint platform_collection_state_module_id_fkey
    foreign key (module_id) references deployment_modules(module_id) on delete restrict,
  constraint platform_collection_state_module_id_check check (
    module_id ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'
    and length(module_id) <= 44
    and module_id not in ('core', 'platform')
  ),
  constraint platform_collection_state_resource_id_check check (
    resource_id ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'
  ),
  constraint platform_collection_state_subject_kind_check check (
    subject_kind in ('deployment', 'character', 'corporation', 'alliance')
  ),
  constraint platform_collection_state_subject_id_check check (
    subject_id <> '' and subject_id = trim(subject_id)
  ),
  constraint platform_collection_state_authorization_generation_check check (
    authorization_generation is null or authorization_generation >= 0
  ),
  constraint platform_collection_state_last_failure_class_check check (
    last_failure_class is null
    or last_failure_class in (
      'authorization-required',
      'esi-cooldown',
      'esi-unavailable',
      'response-invalid',
      'mapping-failed',
      'persistence-failed',
      'unknown'
    )
  )
);

create index platform_collection_state_due_idx
  on platform_collection_state (
    next_eligible_at,
    module_id,
    resource_id,
    subject_kind,
    subject_lifecycle_id,
    subject_id
  )
  where next_eligible_at is not null;
