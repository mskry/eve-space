alter table organization_epochs
  add constraint organization_epochs_identity_key
  unique (deployment_id, organization_version, organization_id);

alter table oauth_states
  add column organization_deployment_id smallint,
  add column organization_id bigint,
  add column organization_version bigint,
  drop constraint oauth_states_intent_check,
  drop constraint oauth_states_context_check,
  add constraint oauth_states_intent_check
    check (intent in ('login', 'attach', 'reauthorize', 'claim-organization-owner')),
  add constraint oauth_states_context_check
    check (
      (
        intent = 'login'
        and user_id is null
        and character_id is null
        and organization_deployment_id is null
        and organization_id is null
        and organization_version is null
      )
      or (
        intent = 'attach'
        and user_id is not null
        and character_id is null
        and organization_deployment_id is null
        and organization_id is null
        and organization_version is null
      )
      or (
        intent = 'reauthorize'
        and user_id is not null
        and character_id is not null
        and organization_deployment_id is null
        and organization_id is null
        and organization_version is null
      )
      or (
        intent = 'claim-organization-owner'
        and user_id is not null
        and character_id is not null
        and organization_deployment_id = 1
        and organization_id is not null
        and organization_version is not null
      )
    ),
  add constraint oauth_states_organization_epoch_fkey
    foreign key (organization_deployment_id, organization_version, organization_id)
    references organization_epochs (deployment_id, organization_version, organization_id)
    on delete cascade;

create index oauth_states_organization_epoch_idx
  on oauth_states (organization_deployment_id, organization_version)
  where organization_deployment_id is not null;
