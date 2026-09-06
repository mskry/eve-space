create table organization_member_blocks (
  block_id uuid primary key default gen_random_uuid(),
  deployment_id smallint not null default 1,
  organization_version bigint not null,
  user_id uuid not null,
  blocked_by_user_id uuid not null,
  reason text not null,
  blocked_at timestamptz not null default now(),
  unblocked_at timestamptz,
  unblocked_by_user_id uuid,
  unblock_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_member_blocks_version_key
    unique (block_id, deployment_id, organization_version, user_id),
  constraint organization_member_blocks_epoch_fkey
    foreign key (deployment_id, organization_version)
    references organization_epochs (deployment_id, organization_version)
    on delete restrict,
  constraint organization_member_blocks_user_id_fkey
    foreign key (user_id) references users (id) on delete cascade,
  constraint organization_member_blocks_blocked_by_user_id_fkey
    foreign key (blocked_by_user_id) references users (id) on delete restrict,
  constraint organization_member_blocks_unblocked_by_user_id_fkey
    foreign key (unblocked_by_user_id) references users (id) on delete restrict,
  constraint organization_member_blocks_reason_check
    check (length(trim(reason)) between 1 and 2000),
  constraint organization_member_blocks_unblock_check
    check (
      (
        unblocked_at is null
        and unblocked_by_user_id is null
        and unblock_reason is null
      )
      or (
        unblocked_at is not null
        and unblocked_at >= blocked_at
        and unblocked_by_user_id is not null
        and length(trim(unblock_reason)) between 1 and 2000
      )
    )
);

create unique index organization_member_blocks_active_key
  on organization_member_blocks (deployment_id, organization_version, user_id)
  where unblocked_at is null;

create index organization_member_blocks_active_subject_idx
  on organization_member_blocks (user_id, deployment_id, organization_version)
  where unblocked_at is null;
