create table organization_epochs (
  deployment_id smallint not null default 1,
  organization_version bigint not null,
  organization_type text not null,
  organization_id bigint not null,
  organization_name text not null,
  organization_ticker text not null,
  created_at timestamptz not null default now(),
  superseded_at timestamptz,
  primary key (deployment_id, organization_version),
  constraint organization_epochs_deployment_check check (deployment_id = 1),
  constraint organization_epochs_version_check check (organization_version > 0),
  constraint organization_epochs_type_check
    check (organization_type in ('corporation', 'alliance')),
  constraint organization_epochs_organization_id_check check (organization_id > 0),
  constraint organization_epochs_superseded_at_check
    check (superseded_at is null or superseded_at >= created_at)
);

insert into organization_epochs (
  deployment_id,
  organization_version,
  organization_type,
  organization_id,
  organization_name,
  organization_ticker,
  created_at
)
select
  id,
  organization_version,
  organization_type,
  organization_id,
  organization_name,
  organization_ticker,
  created_at
from deployment_settings;

alter table deployment_settings
  add constraint deployment_settings_organization_epoch_fkey
  foreign key (id, organization_version)
  references organization_epochs (deployment_id, organization_version)
  on delete restrict;

create table organization_managed_corporations (
  deployment_id smallint not null default 1,
  organization_version bigint not null,
  corporation_id bigint not null,
  is_current boolean not null default true,
  first_observed_at timestamptz not null,
  last_observed_at timestamptz not null,
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (deployment_id, organization_version, corporation_id),
  constraint organization_managed_corporations_epoch_fkey
    foreign key (deployment_id, organization_version)
    references organization_epochs (deployment_id, organization_version)
    on delete restrict,
  constraint organization_managed_corporations_id_check check (corporation_id > 0),
  constraint organization_managed_corporations_observed_at_check
    check (last_observed_at >= first_observed_at),
  constraint organization_managed_corporations_current_check
    check ((is_current and removed_at is null) or (not is_current and removed_at is not null)),
  constraint organization_managed_corporations_removed_at_check
    check (removed_at is null or removed_at >= first_observed_at)
);

create index organization_managed_corporations_current_idx
  on organization_managed_corporations (deployment_id, organization_version, corporation_id)
  where is_current;

create table organization_corporation_sources (
  source_id uuid primary key default gen_random_uuid(),
  deployment_id smallint not null default 1,
  organization_version bigint not null,
  corporation_id bigint not null,
  character_id bigint not null,
  registered_by_user_id uuid not null,
  registered_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by_user_id uuid,
  revocation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_corporation_sources_source_version_key
    unique (source_id, deployment_id, organization_version, corporation_id),
  constraint organization_corporation_sources_managed_corporation_fkey
    foreign key (deployment_id, organization_version, corporation_id)
    references organization_managed_corporations (
      deployment_id,
      organization_version,
      corporation_id
    )
    on delete restrict,
  constraint organization_corporation_sources_character_id_fkey
    foreign key (character_id) references characters (character_id) on delete restrict,
  constraint organization_corporation_sources_registered_by_user_id_fkey
    foreign key (registered_by_user_id) references users (id) on delete restrict,
  constraint organization_corporation_sources_revoked_by_user_id_fkey
    foreign key (revoked_by_user_id) references users (id) on delete restrict,
  constraint organization_corporation_sources_revocation_check
    check (
      (revoked_at is null and revoked_by_user_id is null and revocation_reason is null)
      or (
        revoked_at is not null
        and revoked_by_user_id is not null
        and length(trim(revocation_reason)) > 0
        and revoked_at >= registered_at
      )
    )
);

create unique index organization_corporation_sources_active_key
  on organization_corporation_sources (deployment_id, organization_version, corporation_id)
  where revoked_at is null;

create index organization_corporation_sources_character_idx
  on organization_corporation_sources (character_id)
  where revoked_at is null;

create table organization_corporation_roster_observations (
  deployment_id smallint not null default 1,
  organization_version bigint not null,
  corporation_id bigint not null,
  character_id bigint not null,
  source_id uuid not null,
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (deployment_id, organization_version, corporation_id, character_id),
  constraint organization_corporation_roster_source_fkey
    foreign key (source_id, deployment_id, organization_version, corporation_id)
    references organization_corporation_sources (
      source_id,
      deployment_id,
      organization_version,
      corporation_id
    )
    on delete restrict,
  constraint organization_corporation_roster_character_id_check check (character_id > 0)
);

create index organization_corporation_roster_source_idx
  on organization_corporation_roster_observations (source_id);
