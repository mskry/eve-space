create function is_valid_platform_identifier(value text)
returns boolean
language sql
immutable
strict
return value ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$';

create function is_valid_module_id(value text)
returns boolean
language sql
immutable
strict
return is_valid_platform_identifier(value)
  and length(value) <= 44
  and value not in ('core', 'platform');

create function is_character_subject_kind(value text)
returns boolean
language sql
immutable
strict
return value = 'character';

alter table module_schema_provisioning
  drop constraint module_schema_provisioning_module_id_check,
  add constraint module_schema_provisioning_module_id_check
    check (is_valid_module_id(module_id));

alter table deployment_modules
  drop constraint deployment_modules_module_id_check,
  add constraint deployment_modules_module_id_check check (is_valid_module_id(module_id));

alter table deployment_shell_navigation_order
  drop constraint deployment_shell_navigation_order_owner_id_check,
  add constraint deployment_shell_navigation_order_owner_id_check check (
    owner_id = 'core'
    or (
      is_valid_platform_identifier(owner_id)
      and length(owner_id) <= 44
      and owner_id <> 'platform'
    )
  ),
  drop constraint deployment_shell_navigation_order_navigation_id_check,
  add constraint deployment_shell_navigation_order_navigation_id_check
    check (is_valid_platform_identifier(navigation_id));

alter table platform_subject_lifecycles
  drop constraint platform_subject_lifecycles_subject_kind_check,
  add constraint platform_subject_lifecycles_subject_kind_check check (
    subject_kind in ('deployment', 'corporation', 'alliance')
    or is_character_subject_kind(subject_kind)
  ),
  drop constraint platform_subject_lifecycles_character_binding_check,
  add constraint platform_subject_lifecycles_character_binding_check check (
    (
      is_character_subject_kind(subject_kind)
      and character_id is not null
      and subject_id = character_id::text
    )
    or (not is_character_subject_kind(subject_kind) and character_id is null)
  );

alter table platform_collection_state
  drop constraint platform_collection_state_module_id_check,
  add constraint platform_collection_state_module_id_check check (is_valid_module_id(module_id)),
  drop constraint platform_collection_state_resource_id_check,
  add constraint platform_collection_state_resource_id_check
    check (is_valid_platform_identifier(resource_id)),
  drop constraint platform_collection_state_subject_kind_check,
  add constraint platform_collection_state_subject_kind_check check (
    subject_kind in ('deployment', 'corporation', 'alliance')
    or is_character_subject_kind(subject_kind)
  );
