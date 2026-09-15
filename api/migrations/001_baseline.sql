set local check_function_bodies = false;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;



CREATE FUNCTION public.enforce_character_transfer_approval_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if row(
    old.approval_id,
    old.link_secret_hash,
    old.character_id,
    old.character_name,
    old.source_user_id,
    old.source_subject_lifecycle_id,
    old.source_character_count,
    old.destination_user_id,
    old.destination_main_character_id,
    old.destination_main_character_name,
    old.approved_by_administrator_id,
    old.reason,
    old.created_at,
    old.expires_at
  ) is distinct from row(
    new.approval_id,
    new.link_secret_hash,
    new.character_id,
    new.character_name,
    new.source_user_id,
    new.source_subject_lifecycle_id,
    new.source_character_count,
    new.destination_user_id,
    new.destination_main_character_id,
    new.destination_main_character_name,
    new.approved_by_administrator_id,
    new.reason,
    new.created_at,
    new.expires_at
  ) then
    raise exception 'character transfer approval bindings are immutable';
  end if;

  if old.consumed_at is not null or old.revoked_at is not null then
    raise exception 'terminal character transfer approvals are immutable';
  end if;

  return new;
end;
$$;



CREATE FUNCTION public.enforce_organization_group_assignment_management() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  expected_mode text;
  expected_source text;
begin
  select management_mode, compliance_source
  into expected_mode, expected_source
  from organization_groups
  where group_id = new.group_id
    and deployment_id = new.deployment_id
    and organization_version = new.organization_version
  for share;

  if not found
    or new.assignment_source <> expected_mode
    or new.compliance_source is distinct from expected_source then
    raise exception 'group assignment management does not match its group';
  end if;
  return new;
end;
$$;



CREATE FUNCTION public.is_character_subject_kind(value text) RETURNS boolean
    LANGUAGE sql IMMUTABLE STRICT
    RETURN (value = 'character'::text);



CREATE FUNCTION public.is_valid_platform_identifier(value text) RETURNS boolean
    LANGUAGE sql IMMUTABLE STRICT
    RETURN (value ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'::text);



CREATE FUNCTION public.is_valid_module_id(value text) RETURNS boolean
    LANGUAGE sql IMMUTABLE STRICT
    RETURN (public.is_valid_platform_identifier(value) AND (length(value) <= 44) AND (value <> ALL (ARRAY['core'::text, 'platform'::text])));



CREATE FUNCTION public.platform_classify_resources(resources jsonb, effective_at timestamp with time zone, filter_module_id text DEFAULT NULL::text, filter_resource_id text DEFAULT NULL::text, filter_subject_kind text DEFAULT NULL::text, filter_subject_lifecycle_id uuid DEFAULT NULL::uuid, filter_subject_id text DEFAULT NULL::text) RETURNS TABLE(module_id text, resource_id text, subject_kind text, subject_lifecycle_id uuid, subject_id text, operation_id text, eligibility_status text, expected_authorization_generation integer, authorization_character_id bigint, authorization_character_lifecycle_id uuid, required_scope text, due_reason text, scheduling_key timestamp with time zone, next_eligible_at timestamp with time zone, validated_at timestamp with time zone, last_failure_class text)
    LANGUAGE sql STABLE
    AS $$
  with installed_resources as (
    select
      resource.module_id,
      resource.resource_id,
      resource.subject_kind,
      resource.operation_id,
      resource.required_scope,
      resource.eligibility_kind
    from jsonb_to_recordset(resources) as resource (
      module_id text,
      resource_id text,
      subject_kind text,
      operation_id text,
      required_scope text,
      eligibility_kind text
    )
  ), subject_resources as (
    select
      resource.*,
      lifecycle.subject_lifecycle_id,
      lifecycle.subject_id,
      character.character_id as authorization_character_id,
      lifecycle.subject_lifecycle_id as authorization_character_lifecycle_id,
      token.token_version,
      token.scopes,
      true as durable_authorization_valid
    from installed_resources resource
    join platform_subject_lifecycles lifecycle
      on lifecycle.subject_kind = 'character'
    join characters character
      on character.character_id = lifecycle.character_id
    left join eve_tokens token
      on token.character_id = character.character_id
    where resource.subject_kind = 'character'
      and resource.eligibility_kind = 'current-owned-character'

    union all

    select
      resource.*,
      lifecycle.subject_lifecycle_id,
      lifecycle.subject_id,
      null::bigint,
      null::uuid,
      null::integer,
      null::jsonb,
      true
    from installed_resources resource
    join deployment_settings settings
      on settings.id = 1
      and settings.organization_type = 'alliance'
    join organization_epochs epoch
      on epoch.deployment_id = settings.id
      and epoch.organization_version = settings.organization_version
      and epoch.organization_type = 'alliance'
      and epoch.organization_id = settings.organization_id
    join platform_subject_lifecycles lifecycle
      on lifecycle.organization_deployment_id = epoch.deployment_id
      and lifecycle.organization_version = epoch.organization_version
      and lifecycle.subject_kind = 'alliance'
      and lifecycle.subject_id = epoch.organization_id::text
    where resource.subject_kind = 'alliance'
      and resource.eligibility_kind = 'current-managed-alliance'

    union all

    select
      resource.*,
      lifecycle.subject_lifecycle_id,
      lifecycle.subject_id,
      source.character_id,
      character_lifecycle.subject_lifecycle_id,
      token.token_version,
      token.scopes,
      character.user_id is not null
        and character.corporation_id = source.corporation_id
        and character.affiliation_resolution_state = 'resolved'
        and character.affiliation_checked_at is not null
        and character.next_affiliation_check > effective_at
        and character_lifecycle.subject_lifecycle_id is not null
    from installed_resources resource
    join deployment_settings settings
      on settings.id = 1
    join organization_managed_corporations corporation
      on corporation.deployment_id = settings.id
      and corporation.organization_version = settings.organization_version
      and corporation.is_current
    join organization_corporation_sources source
      on source.deployment_id = corporation.deployment_id
      and source.organization_version = corporation.organization_version
      and source.corporation_id = corporation.corporation_id
      and source.revoked_at is null
    join platform_subject_lifecycles lifecycle
      on lifecycle.corporation_source_id = source.source_id
      and lifecycle.subject_kind = 'corporation'
      and lifecycle.subject_id = source.corporation_id::text
    left join characters character
      on character.character_id = source.character_id
    left join platform_subject_lifecycles character_lifecycle
      on character_lifecycle.character_id = source.character_id
      and is_character_subject_kind(character_lifecycle.subject_kind)
    left join eve_tokens token
      on token.character_id = source.character_id
    where resource.subject_kind = 'corporation'
      and resource.eligibility_kind = 'current-managed-corporation-source'

    union all

    select resource.*, lifecycle.subject_lifecycle_id, lifecycle.subject_id,
      null::bigint, null::uuid, null::integer, null::jsonb, true
    from installed_resources resource
    join deployment_settings settings on settings.id = 1
    join platform_subject_lifecycles lifecycle
      on lifecycle.subject_kind = 'deployment'
      and lifecycle.subject_id = settings.id::text
      and lifecycle.organization_deployment_id = settings.id
      and lifecycle.organization_version = settings.organization_version
    where resource.subject_kind = 'deployment'
      and resource.eligibility_kind = 'current-deployment'
      and resource.required_scope is null
  ), classified as (
    select
      resource.module_id,
      resource.resource_id,
      resource.subject_kind,
      resource.subject_lifecycle_id,
      resource.subject_id,
      resource.operation_id,
      case
        when module_setting.enabled is distinct from true then 'disabled'
        when not resource.durable_authorization_valid then 'authorization-required'
        when resource.required_scope is not null and (
          resource.token_version is null
          or not resource.scopes @> jsonb_build_array(resource.required_scope)
        ) then 'authorization-required'
        when state.last_failure_class = 'authorization-required'
          and state.authorization_generation is not distinct from resource.token_version
          then 'authorization-required'
        when state.last_failure_class in (
          'response-invalid',
          'mapping-failed',
          'persistence-failed',
          'unknown'
        ) and state.authorization_generation is not distinct from (
          case when resource.required_scope is null then null else resource.token_version end
        ) then 'suppressed'
        else 'eligible'
      end as eligibility_status,
      case when resource.required_scope is null then null else resource.token_version end
        as expected_authorization_generation,
      resource.authorization_character_id,
      resource.authorization_character_lifecycle_id,
      resource.required_scope,
      state.module_id is null as state_missing,
      state.authorization_generation,
      state.next_eligible_at,
      state.validated_at,
      state.last_failure_class
    from subject_resources resource
    left join deployment_modules module_setting
      on module_setting.module_id = resource.module_id
    left join platform_collection_state state
      on state.module_id = resource.module_id
      and state.resource_id = resource.resource_id
      and state.subject_kind = resource.subject_kind
      and state.subject_lifecycle_id = resource.subject_lifecycle_id
      and state.subject_id = resource.subject_id
    where (filter_module_id is null or resource.module_id = filter_module_id)
      and (filter_resource_id is null or resource.resource_id = filter_resource_id)
      and (filter_subject_kind is null or resource.subject_kind = filter_subject_kind)
      and (
        filter_subject_lifecycle_id is null
        or resource.subject_lifecycle_id = filter_subject_lifecycle_id
      )
      and (filter_subject_id is null or resource.subject_id = filter_subject_id)
  )
  select
    classified.module_id,
    classified.resource_id,
    classified.subject_kind,
    classified.subject_lifecycle_id,
    classified.subject_id,
    classified.operation_id,
    classified.eligibility_status,
    classified.expected_authorization_generation,
    classified.authorization_character_id,
    classified.authorization_character_lifecycle_id,
    classified.required_scope,
    case
      when classified.eligibility_status <> 'eligible' then null
      when classified.state_missing then 'never-collected'
      when classified.authorization_generation is distinct from
        classified.expected_authorization_generation then 'authorization-changed'
      when classified.next_eligible_at is null then 'unscheduled'
      when classified.next_eligible_at <= effective_at then 'elapsed'
      else 'future'
    end as due_reason,
    case
      when classified.eligibility_status <> 'eligible' then null
      when classified.state_missing
        or classified.authorization_generation is distinct from
          classified.expected_authorization_generation
        or classified.next_eligible_at is null then 'epoch'::timestamptz
      else classified.next_eligible_at
    end as scheduling_key,
    classified.next_eligible_at,
    classified.validated_at,
    classified.last_failure_class
  from classified;
$$;



CREATE FUNCTION public.prevent_character_transfer_audit_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  raise exception 'character transfer audit is append-only';
end;
$$;



CREATE FUNCTION public.prevent_domain_event_envelope_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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



CREATE FUNCTION public.prevent_organization_audit_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  raise exception 'organization audit events are append-only';
end;
$$;



CREATE FUNCTION public.prevent_organization_group_management_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if (
    old.management_mode is distinct from new.management_mode
    or old.compliance_source is distinct from new.compliance_source
  ) and exists (
    select 1
    from organization_group_assignments
    where group_id = old.group_id
  ) then
    raise exception 'group management cannot change after assignment';
  end if;
  return new;
end;
$$;



CREATE FUNCTION public.validate_organization_authority_evidence_character_owner() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if not exists (
    select 1
    from characters
    where user_id = new.user_id
      and character_id = new.character_id
  ) then
    raise foreign_key_violation using
      constraint = 'organization_authority_evidence_character_owner_check',
      message = 'organization authority evidence character must belong to its user';
  end if;
  return new;
end;
$$;





CREATE TABLE public.admin_sessions (
    session_hash character varying(64) NOT NULL,
    admin_id uuid NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT admin_sessions_session_hash_length_check CHECK ((length((session_hash)::text) = 64))
);



CREATE TABLE public.character_transfer_approvals (
    approval_id uuid DEFAULT gen_random_uuid() NOT NULL,
    link_secret_hash character varying(64) NOT NULL,
    character_id bigint NOT NULL,
    character_name text NOT NULL,
    source_user_id uuid NOT NULL,
    source_subject_lifecycle_id uuid NOT NULL,
    source_character_count integer NOT NULL,
    destination_user_id uuid NOT NULL,
    destination_main_character_id bigint NOT NULL,
    destination_main_character_name text NOT NULL,
    approved_by_administrator_id uuid NOT NULL,
    reason character varying(1000) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    consumed_by_user_id uuid,
    new_subject_lifecycle_id uuid,
    revoked_at timestamp with time zone,
    revoked_by_administrator_id uuid,
    revocation_reason character varying(1000),
    CONSTRAINT character_transfer_approvals_accounts_check CHECK ((source_user_id <> destination_user_id)),
    CONSTRAINT character_transfer_approvals_consumed_check CHECK ((((consumed_at IS NULL) AND (consumed_by_user_id IS NULL) AND (new_subject_lifecycle_id IS NULL)) OR ((consumed_at IS NOT NULL) AND (consumed_by_user_id = destination_user_id) AND (new_subject_lifecycle_id IS NOT NULL) AND (consumed_at >= created_at)))),
    CONSTRAINT character_transfer_approvals_expiry_check CHECK ((expires_at = (created_at + '00:15:00'::interval))),
    CONSTRAINT character_transfer_approvals_reason_check CHECK ((((reason)::text = TRIM(BOTH FROM reason)) AND ((length((reason)::text) >= 1) AND (length((reason)::text) <= 1000)))),
    CONSTRAINT character_transfer_approvals_revoked_check CHECK ((((revoked_at IS NULL) AND (revoked_by_administrator_id IS NULL) AND (revocation_reason IS NULL)) OR ((revoked_at IS NOT NULL) AND (revoked_by_administrator_id IS NOT NULL) AND (revocation_reason IS NOT NULL) AND ((revocation_reason)::text = TRIM(BOTH FROM revocation_reason)) AND ((length((revocation_reason)::text) >= 1) AND (length((revocation_reason)::text) <= 1000)) AND (revoked_at >= created_at)))),
    CONSTRAINT character_transfer_approvals_secret_hash_check CHECK (((link_secret_hash)::text ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT character_transfer_approvals_source_count_check CHECK ((source_character_count > 0)),
    CONSTRAINT character_transfer_approvals_terminal_state_check CHECK (((consumed_at IS NULL) OR (revoked_at IS NULL)))
);



CREATE TABLE public.character_transfer_audit (
    audit_id uuid DEFAULT gen_random_uuid() NOT NULL,
    approval_id uuid NOT NULL,
    action text NOT NULL,
    approved_by_administrator_id uuid NOT NULL,
    action_administrator_id uuid,
    acting_destination_user_id uuid,
    character_id bigint NOT NULL,
    source_user_id uuid NOT NULL,
    source_subject_lifecycle_id uuid NOT NULL,
    destination_user_id uuid NOT NULL,
    new_subject_lifecycle_id uuid,
    source_event_id uuid,
    destination_event_id uuid,
    reason character varying(1000) NOT NULL,
    outcome text NOT NULL,
    occurred_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT character_transfer_audit_accounts_check CHECK ((source_user_id <> destination_user_id)),
    CONSTRAINT character_transfer_audit_action_check CHECK ((action = ANY (ARRAY['created'::text, 'revoked'::text, 'consumed'::text]))),
    CONSTRAINT character_transfer_audit_administrator_check CHECK ((((action = 'consumed'::text) AND (action_administrator_id IS NULL)) OR ((action <> 'consumed'::text) AND (action_administrator_id IS NOT NULL)))),
    CONSTRAINT character_transfer_audit_consumption_check CHECK ((((action = 'consumed'::text) AND (acting_destination_user_id = destination_user_id) AND (new_subject_lifecycle_id IS NOT NULL) AND (source_event_id IS NOT NULL) AND (destination_event_id IS NOT NULL)) OR ((action <> 'consumed'::text) AND (acting_destination_user_id IS NULL) AND (new_subject_lifecycle_id IS NULL) AND (source_event_id IS NULL) AND (destination_event_id IS NULL)))),
    CONSTRAINT character_transfer_audit_outcome_check CHECK ((outcome = ANY (ARRAY['created'::text, 'revoked'::text, 'consumed'::text]))),
    CONSTRAINT character_transfer_audit_reason_check CHECK ((((reason)::text = TRIM(BOTH FROM reason)) AND ((length((reason)::text) >= 1) AND (length((reason)::text) <= 1000))))
);



CREATE TABLE public.character_transfer_previews (
    preview_id uuid DEFAULT gen_random_uuid() NOT NULL,
    administrator_id uuid NOT NULL,
    character_id bigint NOT NULL,
    character_name text NOT NULL,
    source_user_id uuid NOT NULL,
    source_subject_lifecycle_id uuid NOT NULL,
    source_character_count integer NOT NULL,
    destination_user_id uuid NOT NULL,
    destination_main_character_id bigint NOT NULL,
    destination_main_character_name text NOT NULL,
    reason character varying(1000) NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT character_transfer_previews_accounts_check CHECK ((source_user_id <> destination_user_id)),
    CONSTRAINT character_transfer_previews_expiry_check CHECK ((expires_at = (created_at + '00:05:00'::interval))),
    CONSTRAINT character_transfer_previews_reason_check CHECK ((((reason)::text = TRIM(BOTH FROM reason)) AND ((length((reason)::text) >= 1) AND (length((reason)::text) <= 1000)))),
    CONSTRAINT character_transfer_previews_source_count_check CHECK ((source_character_count > 0))
);



CREATE TABLE public.characters (
    character_id bigint NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    corporation_id bigint NOT NULL,
    alliance_id bigint,
    is_main boolean DEFAULT false NOT NULL,
    affiliation_checked_at timestamp with time zone,
    next_affiliation_check timestamp with time zone,
    affiliation_resolution_state text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT characters_affiliation_resolution_state_check CHECK ((affiliation_resolution_state = ANY (ARRAY['pending'::text, 'resolved'::text, 'unresolvable'::text])))
);



CREATE TABLE public.deployment_admins (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT deployment_admins_email_normalized_check CHECK ((email = lower(TRIM(BOTH FROM email))))
);



CREATE TABLE public.deployment_installation_settings (
    id smallint DEFAULT 1 NOT NULL,
    planner_schedule_offset_ms integer DEFAULT (floor((random() * (60000)::double precision)))::integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    owner_admin_id uuid,
    CONSTRAINT deployment_installation_settings_planner_offset_check CHECK ((planner_schedule_offset_ms >= 0)),
    CONSTRAINT deployment_installation_settings_singleton_check CHECK ((id = 1))
);



CREATE TABLE public.deployment_modules (
    module_id text NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT deployment_modules_core_enabled_check CHECK (((module_id <> 'core'::text) OR enabled)),
    CONSTRAINT deployment_modules_module_id_check CHECK (((module_id = 'core'::text) OR (public.is_valid_module_id(module_id) AND (length(module_id) <= 44) AND (module_id <> 'platform'::text))))
);



CREATE TABLE public.deployment_settings (
    id smallint DEFAULT 1 NOT NULL,
    organization_type text NOT NULL,
    organization_id bigint NOT NULL,
    organization_name text NOT NULL,
    organization_ticker text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    organization_version bigint DEFAULT 1 NOT NULL,
    strict_remediation_duration_seconds integer DEFAULT 0 NOT NULL,
    stale_evidence_grace_duration_seconds integer DEFAULT 3600 NOT NULL,
    required_registration_scopes jsonb DEFAULT '[]'::jsonb NOT NULL,
    registration_policy_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT deployment_settings_organization_id_check CHECK ((organization_id > 0)),
    CONSTRAINT deployment_settings_organization_type_check CHECK ((organization_type = ANY (ARRAY['corporation'::text, 'alliance'::text]))),
    CONSTRAINT deployment_settings_organization_version_check CHECK ((organization_version > 0)),
    CONSTRAINT deployment_settings_registration_policy_version_check CHECK ((registration_policy_version > 0)),
    CONSTRAINT deployment_settings_required_registration_scopes_array_check CHECK ((jsonb_typeof(required_registration_scopes) = 'array'::text)),
    CONSTRAINT deployment_settings_required_registration_scopes_values_check CHECK ((NOT jsonb_path_exists(required_registration_scopes, '$[*]?(@.type() != "string")'::jsonpath))),
    CONSTRAINT deployment_settings_singleton_check CHECK ((id = 1)),
    CONSTRAINT deployment_settings_stale_evidence_grace_duration_check CHECK (((stale_evidence_grace_duration_seconds >= 0) AND (stale_evidence_grace_duration_seconds <= 86400))),
    CONSTRAINT deployment_settings_strict_remediation_duration_check CHECK (((strict_remediation_duration_seconds >= 0) AND (strict_remediation_duration_seconds <= 2592000)))
);



CREATE TABLE public.deployment_shell_navigation_order (
    owner_id text NOT NULL,
    navigation_id text NOT NULL,
    "position" integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT deployment_shell_navigation_order_navigation_id_check CHECK (public.is_valid_platform_identifier(navigation_id)),
    CONSTRAINT deployment_shell_navigation_order_owner_id_check CHECK (((owner_id = 'core'::text) OR (public.is_valid_platform_identifier(owner_id) AND (length(owner_id) <= 44) AND (owner_id <> 'platform'::text)))),
    CONSTRAINT deployment_shell_navigation_order_position_check CHECK (("position" >= 0))
);



CREATE TABLE public.domain_events (
    event_id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_sequence bigint NOT NULL,
    event_type text NOT NULL,
    payload_version integer NOT NULL,
    aggregate_type text NOT NULL,
    aggregate_id text NOT NULL,
    payload jsonb NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    pending_since timestamp with time zone DEFAULT now() NOT NULL,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    claim_token uuid,
    claim_expires_at timestamp with time zone,
    publish_attempts integer DEFAULT 0 NOT NULL,
    last_failure_category text,
    last_failure_at timestamp with time zone,
    published_at timestamp with time zone,
    CONSTRAINT domain_events_aggregate_identity_check CHECK (((aggregate_type <> ''::text) AND (aggregate_id <> ''::text))),
    CONSTRAINT domain_events_claim_pair_check CHECK (((claim_token IS NULL) = (claim_expires_at IS NULL))),
    CONSTRAINT domain_events_event_type_check CHECK ((event_type <> ''::text)),
    CONSTRAINT domain_events_failure_category_check CHECK (((last_failure_category IS NULL) OR (last_failure_category = ANY (ARRAY['queue-unavailable'::text, 'queue-rejected'::text, 'invalid-event'::text, 'unknown'::text])))),
    CONSTRAINT domain_events_failure_pair_check CHECK (((last_failure_category IS NULL) = (last_failure_at IS NULL))),
    CONSTRAINT domain_events_payload_object_check CHECK ((jsonb_typeof(payload) = 'object'::text)),
    CONSTRAINT domain_events_payload_version_check CHECK ((payload_version > 0)),
    CONSTRAINT domain_events_publish_attempts_check CHECK ((publish_attempts >= 0)),
    CONSTRAINT domain_events_published_claim_check CHECK (((published_at IS NULL) OR (claim_token IS NULL)))
);



ALTER TABLE public.domain_events ALTER COLUMN event_sequence ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.domain_events_event_sequence_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE public.eve_tokens (
    character_id bigint NOT NULL,
    encrypted_tokens text NOT NULL,
    access_token_expires_at timestamp with time zone NOT NULL,
    scopes jsonb DEFAULT '[]'::jsonb NOT NULL,
    token_version integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT eve_tokens_scopes_is_array CHECK ((jsonb_typeof(scopes) = 'array'::text))
);



CREATE TABLE public.module_persistence_contract (
    singleton boolean DEFAULT true NOT NULL,
    contract_fingerprint text NOT NULL,
    operation_count integer NOT NULL,
    reconciled_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT module_persistence_contract_fingerprint_check CHECK ((contract_fingerprint ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT module_persistence_contract_operation_count_check CHECK ((operation_count >= 0)),
    CONSTRAINT module_persistence_contract_singleton_check CHECK (singleton)
);



CREATE TABLE public.module_persistence_operation_attestations (
    module_id text NOT NULL,
    operation_id text NOT NULL,
    revision integer NOT NULL,
    mode text NOT NULL,
    migration_name text NOT NULL,
    schema_name text NOT NULL,
    routine_name text NOT NULL,
    definition_fingerprint text NOT NULL,
    attested_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT module_persistence_operation_attestations_fingerprint_check CHECK ((definition_fingerprint ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT module_persistence_operation_attestations_migration_name_check CHECK ((migration_name ~ '^[A-Za-z0-9][A-Za-z0-9._-]*\.sql$'::text)),
    CONSTRAINT module_persistence_operation_attestations_mode_check CHECK ((mode = ANY (ARRAY['read'::text, 'write'::text]))),
    CONSTRAINT module_persistence_operation_attestations_module_id_check CHECK (public.is_valid_module_id(module_id)),
    CONSTRAINT module_persistence_operation_attestations_operation_id_check CHECK (((length(operation_id) <= 54) AND (operation_id ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'::text))),
    CONSTRAINT module_persistence_operation_attestations_revision_check CHECK ((revision > 0)),
    CONSTRAINT module_persistence_operation_attestations_routine_name_check CHECK ((routine_name ~ '^persist_[a-z0-9_]+$'::text)),
    CONSTRAINT module_persistence_operation_attestations_schema_name_check CHECK ((schema_name ~ '^eve_module_[a-z0-9_]+$'::text))
);



CREATE TABLE public.module_schema_provisioning (
    module_id text NOT NULL,
    provisioned_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT module_schema_provisioning_module_id_check CHECK (public.is_valid_module_id(module_id))
);



CREATE TABLE public.oauth_states (
    state_hash character varying(64) NOT NULL,
    intent text DEFAULT 'login'::text NOT NULL,
    user_id uuid,
    character_id bigint,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    return_path character varying(512),
    organization_deployment_id smallint,
    organization_id bigint,
    organization_version bigint,
    transfer_approval_id uuid,
    transfer_source_user_id uuid,
    transfer_source_subject_lifecycle_id uuid,
    CONSTRAINT oauth_states_context_check CHECK ((((intent = 'login'::text) AND (user_id IS NULL) AND (character_id IS NULL) AND (organization_deployment_id IS NULL) AND (organization_id IS NULL) AND (organization_version IS NULL) AND (transfer_approval_id IS NULL) AND (transfer_source_user_id IS NULL) AND (transfer_source_subject_lifecycle_id IS NULL)) OR ((intent = 'attach'::text) AND (user_id IS NOT NULL) AND (character_id IS NULL) AND (organization_deployment_id IS NULL) AND (organization_id IS NULL) AND (organization_version IS NULL) AND (transfer_approval_id IS NULL) AND (transfer_source_user_id IS NULL) AND (transfer_source_subject_lifecycle_id IS NULL)) OR ((intent = 'reauthorize'::text) AND (user_id IS NOT NULL) AND (character_id IS NOT NULL) AND (organization_deployment_id IS NULL) AND (organization_id IS NULL) AND (organization_version IS NULL) AND (transfer_approval_id IS NULL) AND (transfer_source_user_id IS NULL) AND (transfer_source_subject_lifecycle_id IS NULL)) OR ((intent = 'claim-organization-owner'::text) AND (user_id IS NOT NULL) AND (character_id IS NOT NULL) AND (organization_deployment_id = 1) AND (organization_id IS NOT NULL) AND (organization_version IS NOT NULL) AND (transfer_approval_id IS NULL) AND (transfer_source_user_id IS NULL) AND (transfer_source_subject_lifecycle_id IS NULL)) OR ((intent = 'transfer'::text) AND (user_id IS NOT NULL) AND (character_id IS NOT NULL) AND (organization_deployment_id IS NULL) AND (organization_id IS NULL) AND (organization_version IS NULL) AND (transfer_approval_id IS NOT NULL) AND (transfer_source_user_id IS NOT NULL) AND (transfer_source_subject_lifecycle_id IS NOT NULL)))),
    CONSTRAINT oauth_states_intent_check CHECK ((intent = ANY (ARRAY['login'::text, 'attach'::text, 'reauthorize'::text, 'claim-organization-owner'::text, 'transfer'::text]))),
    CONSTRAINT oauth_states_return_path_context_check CHECK (((return_path IS NULL) OR (intent = ANY (ARRAY['login'::text, 'reauthorize'::text])))),
    CONSTRAINT oauth_states_state_hash_length_check CHECK ((length((state_hash)::text) = 64))
);



CREATE TABLE public.organization_account_compliance (
    deployment_id smallint DEFAULT 1 NOT NULL,
    organization_version bigint NOT NULL,
    user_id uuid NOT NULL,
    state text DEFAULT 'pending'::text NOT NULL,
    evidence_freshness text DEFAULT 'unavailable'::text NOT NULL,
    evidence_at timestamp with time zone,
    review_deadline timestamp with time zone,
    established_compliant_at timestamp with time zone,
    evaluated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    authoritative boolean DEFAULT true NOT NULL,
    invalidated_at timestamp with time zone,
    access_valid_until timestamp with time zone,
    CONSTRAINT organization_account_compliance_access_validity_check CHECK ((((state = 'compliant'::text) AND (access_valid_until IS NOT NULL)) OR ((state = 'review_required'::text) AND (((established_compliant_at IS NULL) AND (access_valid_until IS NULL)) OR ((established_compliant_at IS NOT NULL) AND (access_valid_until IS NOT NULL) AND (access_valid_until <= review_deadline)))) OR ((state = ANY (ARRAY['pending'::text, 'suspended'::text])) AND (access_valid_until IS NULL)))),
    CONSTRAINT organization_account_compliance_authoritative_check CHECK (((authoritative AND (invalidated_at IS NULL)) OR ((NOT authoritative) AND (invalidated_at IS NOT NULL)))),
    CONSTRAINT organization_account_compliance_deadline_check CHECK (((review_deadline IS NULL) OR (state = ANY (ARRAY['review_required'::text, 'suspended'::text])))),
    CONSTRAINT organization_account_compliance_established_check CHECK (((established_compliant_at IS NULL) OR (established_compliant_at <= evaluated_at))),
    CONSTRAINT organization_account_compliance_evidence_check CHECK ((((evidence_freshness = 'unavailable'::text) AND (evidence_at IS NULL)) OR ((evidence_freshness <> 'unavailable'::text) AND (evidence_at IS NOT NULL)))),
    CONSTRAINT organization_account_compliance_freshness_check CHECK ((evidence_freshness = ANY (ARRAY['fresh'::text, 'stale'::text, 'unavailable'::text]))),
    CONSTRAINT organization_account_compliance_state_check CHECK ((state = ANY (ARRAY['pending'::text, 'compliant'::text, 'review_required'::text, 'suspended'::text])))
);



CREATE TABLE public.organization_audit_events (
    audit_id uuid DEFAULT gen_random_uuid() NOT NULL,
    audit_sequence bigint NOT NULL,
    deployment_id smallint DEFAULT 1 NOT NULL,
    organization_version bigint NOT NULL,
    policy_version bigint NOT NULL,
    event_type text NOT NULL,
    actor_type text NOT NULL,
    actor_id uuid,
    subject_type text NOT NULL,
    subject_id text NOT NULL,
    reason text NOT NULL,
    outcome text NOT NULL,
    causation_audit_id uuid,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    group_id uuid,
    assignment_id uuid,
    target_user_id uuid,
    assignment_source text,
    compliance_source text,
    entitlement_expires_at timestamp with time zone,
    CONSTRAINT organization_audit_events_actor_check CHECK ((((actor_type = ANY (ARRAY['user'::text, 'deployment_admin'::text])) AND (actor_id IS NOT NULL)) OR ((actor_type = 'system'::text) AND (actor_id IS NULL)))),
    CONSTRAINT organization_audit_events_group_assignment_check CHECK ((((event_type = ANY (ARRAY['group.assigned'::text, 'group.revoked'::text])) AND (group_id IS NOT NULL) AND (assignment_id IS NOT NULL) AND (target_user_id IS NOT NULL) AND (assignment_source = ANY (ARRAY['manual'::text, 'compliance'::text])) AND (((assignment_source = 'manual'::text) AND (compliance_source IS NULL)) OR ((assignment_source = 'compliance'::text) AND (compliance_source IS NOT NULL)))) OR ((event_type <> ALL (ARRAY['group.assigned'::text, 'group.revoked'::text])) AND (group_id IS NULL) AND (assignment_id IS NULL) AND (target_user_id IS NULL) AND (assignment_source IS NULL) AND (compliance_source IS NULL) AND (entitlement_expires_at IS NULL)))),
    CONSTRAINT organization_audit_events_outcome_check CHECK ((outcome = ANY (ARRAY['granted'::text, 'revoked'::text, 'transitioned'::text, 'denied'::text, 'unchanged'::text]))),
    CONSTRAINT organization_audit_events_policy_version_check CHECK ((policy_version > 0)),
    CONSTRAINT organization_audit_events_reason_check CHECK (((length(TRIM(BOTH FROM reason)) > 0) AND (length(reason) <= 2000))),
    CONSTRAINT organization_audit_events_subject_id_check CHECK (((length(TRIM(BOTH FROM subject_id)) > 0) AND (length(subject_id) <= 255))),
    CONSTRAINT organization_audit_events_subject_type_check CHECK ((subject_type = ANY (ARRAY['deployment'::text, 'user'::text, 'character'::text, 'role_grant'::text, 'exception'::text, 'compliance'::text, 'corporation_source'::text, 'managed_corporation'::text, 'group'::text, 'external_service'::text]))),
    CONSTRAINT organization_audit_events_type_check CHECK ((event_type = ANY (ARRAY['organization.changed'::text, 'registration-policy.changed'::text, 'role.granted'::text, 'role.revoked'::text, 'exception.approved'::text, 'exception.expired'::text, 'exception.revoked'::text, 'compliance.transitioned'::text, 'entitlement.granted'::text, 'entitlement.revoked'::text, 'corporation-source.registered'::text, 'corporation-source.replaced'::text, 'corporation-source.revoked'::text, 'group.assigned'::text, 'group.revoked'::text, 'member.blocked'::text, 'member.unblocked'::text])))
);



ALTER TABLE public.organization_audit_events ALTER COLUMN audit_sequence ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.organization_audit_events_audit_sequence_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE public.organization_authority_evidence (
    evidence_id uuid DEFAULT gen_random_uuid() NOT NULL,
    grant_id uuid NOT NULL,
    deployment_id smallint DEFAULT 1 NOT NULL,
    organization_version bigint NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'organization_owner'::text NOT NULL,
    character_id bigint NOT NULL,
    authority_corporation_id bigint NOT NULL,
    observed_corporation_id bigint NOT NULL,
    observed_alliance_id bigint,
    required_scope text NOT NULL,
    director_role_present boolean NOT NULL,
    status text NOT NULL,
    verified_at timestamp with time zone,
    last_checked_at timestamp with time zone NOT NULL,
    review_deadline timestamp with time zone,
    failure_class text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT organization_authority_evidence_checked_at_check CHECK (((verified_at IS NULL) OR (last_checked_at >= verified_at))),
    CONSTRAINT organization_authority_evidence_corporation_check CHECK (((authority_corporation_id > 0) AND (observed_corporation_id = authority_corporation_id))),
    CONSTRAINT organization_authority_evidence_review_check CHECK (((review_deadline IS NULL) OR (status = 'review_required'::text))),
    CONSTRAINT organization_authority_evidence_role_check CHECK ((role = 'organization_owner'::text)),
    CONSTRAINT organization_authority_evidence_scope_check CHECK ((length(TRIM(BOTH FROM required_scope)) > 0)),
    CONSTRAINT organization_authority_evidence_status_check CHECK ((status = ANY (ARRAY['fresh'::text, 'review_required'::text, 'invalid'::text]))),
    CONSTRAINT organization_authority_evidence_verified_at_check CHECK ((((status = 'fresh'::text) AND (verified_at IS NOT NULL) AND director_role_present AND (failure_class IS NULL)) OR ((status <> 'fresh'::text) AND (failure_class IS NOT NULL))))
);



CREATE TABLE public.organization_character_exceptions (
    exception_id uuid DEFAULT gen_random_uuid() NOT NULL,
    deployment_id smallint DEFAULT 1 NOT NULL,
    organization_version bigint NOT NULL,
    user_id uuid NOT NULL,
    character_id bigint NOT NULL,
    approver_user_id uuid NOT NULL,
    reason text NOT NULL,
    approved_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    revoked_at timestamp with time zone,
    revoked_by_user_id uuid,
    revocation_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    expired_at timestamp with time zone,
    CONSTRAINT organization_character_exceptions_expired_at_check CHECK (((expired_at IS NULL) OR ((expires_at IS NOT NULL) AND (expired_at >= expires_at)))),
    CONSTRAINT organization_character_exceptions_expiry_check CHECK (((expires_at IS NULL) OR (expires_at > approved_at))),
    CONSTRAINT organization_character_exceptions_reason_check CHECK ((length(TRIM(BOTH FROM reason)) > 0)),
    CONSTRAINT organization_character_exceptions_revocation_check CHECK ((((revoked_at IS NULL) AND (revoked_by_user_id IS NULL) AND (revocation_reason IS NULL)) OR ((revoked_at IS NOT NULL) AND (revoked_by_user_id IS NOT NULL) AND (length(TRIM(BOTH FROM revocation_reason)) > 0) AND (revoked_at >= approved_at))))
);



CREATE TABLE public.organization_compliance_issues (
    issue_id uuid DEFAULT gen_random_uuid() NOT NULL,
    deployment_id smallint DEFAULT 1 NOT NULL,
    organization_version bigint NOT NULL,
    user_id uuid NOT NULL,
    issue_key text NOT NULL,
    issue_code text NOT NULL,
    character_id bigint,
    required_scope text,
    first_observed_at timestamp with time zone NOT NULL,
    last_observed_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT organization_compliance_issues_code_check CHECK ((length(TRIM(BOTH FROM issue_code)) > 0)),
    CONSTRAINT organization_compliance_issues_key_check CHECK ((length(TRIM(BOTH FROM issue_key)) > 0)),
    CONSTRAINT organization_compliance_issues_observed_at_check CHECK ((last_observed_at >= first_observed_at)),
    CONSTRAINT organization_compliance_issues_required_scope_check CHECK (((required_scope IS NULL) OR (length(TRIM(BOTH FROM required_scope)) > 0)))
);



CREATE TABLE public.organization_corporation_roster_observations (
    deployment_id smallint DEFAULT 1 NOT NULL,
    organization_version bigint NOT NULL,
    corporation_id bigint NOT NULL,
    character_id bigint NOT NULL,
    source_id uuid NOT NULL,
    observed_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    authorization_generation integer NOT NULL,
    CONSTRAINT organization_corporation_roster_authorization_generation_check CHECK ((authorization_generation >= 0)),
    CONSTRAINT organization_corporation_roster_character_id_check CHECK ((character_id > 0))
);



CREATE TABLE public.organization_corporation_sources (
    source_id uuid DEFAULT gen_random_uuid() NOT NULL,
    deployment_id smallint DEFAULT 1 NOT NULL,
    organization_version bigint NOT NULL,
    corporation_id bigint NOT NULL,
    character_id bigint,
    registered_by_user_id uuid NOT NULL,
    registered_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    revoked_by_user_id uuid,
    revocation_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    evidence_character_id bigint NOT NULL,
    CONSTRAINT organization_corporation_sources_evidence_character_id_check CHECK ((evidence_character_id > 0)),
    CONSTRAINT organization_corporation_sources_revocation_check CHECK ((((revoked_at IS NULL) AND (revoked_by_user_id IS NULL) AND (revocation_reason IS NULL)) OR ((revoked_at IS NOT NULL) AND (revoked_by_user_id IS NOT NULL) AND (length(TRIM(BOTH FROM revocation_reason)) > 0) AND (revoked_at >= registered_at))))
);



CREATE TABLE public.organization_epochs (
    deployment_id smallint DEFAULT 1 NOT NULL,
    organization_version bigint NOT NULL,
    organization_type text NOT NULL,
    organization_id bigint NOT NULL,
    organization_name text NOT NULL,
    organization_ticker text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    superseded_at timestamp with time zone,
    CONSTRAINT organization_epochs_deployment_check CHECK ((deployment_id = 1)),
    CONSTRAINT organization_epochs_organization_id_check CHECK ((organization_id > 0)),
    CONSTRAINT organization_epochs_superseded_at_check CHECK (((superseded_at IS NULL) OR (superseded_at >= created_at))),
    CONSTRAINT organization_epochs_type_check CHECK ((organization_type = ANY (ARRAY['corporation'::text, 'alliance'::text]))),
    CONSTRAINT organization_epochs_version_check CHECK ((organization_version > 0))
);



CREATE TABLE public.organization_group_assignments (
    assignment_id uuid DEFAULT gen_random_uuid() NOT NULL,
    group_id uuid NOT NULL,
    deployment_id smallint DEFAULT 1 NOT NULL,
    organization_version bigint NOT NULL,
    user_id uuid NOT NULL,
    assignment_source text NOT NULL,
    compliance_source text,
    assigned_actor_type text NOT NULL,
    assigned_by_user_id uuid,
    reason text NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    revoked_at timestamp with time zone,
    revoked_actor_type text,
    revoked_by_user_id uuid,
    revocation_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT organization_group_assignments_assignment_actor_check CHECK ((((assignment_source = 'manual'::text) AND (assigned_actor_type = 'user'::text) AND (assigned_by_user_id IS NOT NULL)) OR ((assignment_source = 'compliance'::text) AND (assigned_actor_type = 'system'::text) AND (assigned_by_user_id IS NULL) AND (expires_at IS NULL)))),
    CONSTRAINT organization_group_assignments_expiry_check CHECK (((expires_at IS NULL) OR (expires_at > assigned_at))),
    CONSTRAINT organization_group_assignments_reason_check CHECK (((length(TRIM(BOTH FROM reason)) >= 1) AND (length(TRIM(BOTH FROM reason)) <= 2000))),
    CONSTRAINT organization_group_assignments_revocation_check CHECK ((((revoked_at IS NULL) AND (revoked_actor_type IS NULL) AND (revoked_by_user_id IS NULL) AND (revocation_reason IS NULL)) OR ((revoked_at IS NOT NULL) AND (revoked_at >= assigned_at) AND (revoked_actor_type = ANY (ARRAY['user'::text, 'system'::text])) AND (((revoked_actor_type = 'user'::text) AND (revoked_by_user_id IS NOT NULL)) OR ((revoked_actor_type = 'system'::text) AND (revoked_by_user_id IS NULL))) AND ((length(TRIM(BOTH FROM revocation_reason)) >= 1) AND (length(TRIM(BOTH FROM revocation_reason)) <= 2000))))),
    CONSTRAINT organization_group_assignments_source_check CHECK ((assignment_source = ANY (ARRAY['manual'::text, 'compliance'::text])))
);



CREATE TABLE public.organization_group_permission_bundles (
    group_id uuid NOT NULL,
    bundle_id uuid NOT NULL,
    deployment_id smallint DEFAULT 1 NOT NULL,
    organization_version bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);



CREATE TABLE public.organization_groups (
    group_id uuid DEFAULT gen_random_uuid() NOT NULL,
    deployment_id smallint DEFAULT 1 NOT NULL,
    organization_version bigint NOT NULL,
    name text NOT NULL,
    restricted boolean DEFAULT false NOT NULL,
    management_mode text DEFAULT 'manual'::text NOT NULL,
    compliance_source text,
    created_by_user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT organization_groups_management_check CHECK ((((management_mode = 'manual'::text) AND (compliance_source IS NULL)) OR ((management_mode = 'compliance'::text) AND (compliance_source = 'core.registration'::text)))),
    CONSTRAINT organization_groups_name_check CHECK (((name = TRIM(BOTH FROM name)) AND ((length(name) >= 1) AND (length(name) <= 100))))
);



CREATE TABLE public.organization_managed_corporations (
    deployment_id smallint DEFAULT 1 NOT NULL,
    organization_version bigint NOT NULL,
    corporation_id bigint NOT NULL,
    is_current boolean DEFAULT true NOT NULL,
    first_observed_at timestamp with time zone NOT NULL,
    last_observed_at timestamp with time zone NOT NULL,
    removed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT organization_managed_corporations_current_check CHECK (((is_current AND (removed_at IS NULL)) OR ((NOT is_current) AND (removed_at IS NOT NULL)))),
    CONSTRAINT organization_managed_corporations_id_check CHECK ((corporation_id > 0)),
    CONSTRAINT organization_managed_corporations_observed_at_check CHECK ((last_observed_at >= first_observed_at)),
    CONSTRAINT organization_managed_corporations_removed_at_check CHECK (((removed_at IS NULL) OR (removed_at >= first_observed_at)))
);



CREATE TABLE public.organization_member_blocks (
    block_id uuid DEFAULT gen_random_uuid() NOT NULL,
    deployment_id smallint DEFAULT 1 NOT NULL,
    organization_version bigint NOT NULL,
    user_id uuid NOT NULL,
    blocked_by_user_id uuid NOT NULL,
    reason text NOT NULL,
    blocked_at timestamp with time zone DEFAULT now() NOT NULL,
    unblocked_at timestamp with time zone,
    unblocked_by_user_id uuid,
    unblock_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT organization_member_blocks_reason_check CHECK (((length(TRIM(BOTH FROM reason)) >= 1) AND (length(TRIM(BOTH FROM reason)) <= 2000))),
    CONSTRAINT organization_member_blocks_unblock_check CHECK ((((unblocked_at IS NULL) AND (unblocked_by_user_id IS NULL) AND (unblock_reason IS NULL)) OR ((unblocked_at IS NOT NULL) AND (unblocked_at >= blocked_at) AND (unblocked_by_user_id IS NOT NULL) AND ((length(TRIM(BOTH FROM unblock_reason)) >= 1) AND (length(TRIM(BOTH FROM unblock_reason)) <= 2000)))))
);



CREATE TABLE public.organization_permission_bundle_entries (
    bundle_id uuid NOT NULL,
    deployment_id smallint DEFAULT 1 NOT NULL,
    organization_version bigint NOT NULL,
    permission_type text NOT NULL,
    permission_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    review_allowed boolean DEFAULT false NOT NULL,
    CONSTRAINT organization_permission_bundle_entries_key_check CHECK ((length(permission_key) BETWEEN 1 AND 200) AND (permission_key ~ '^[a-z][a-z0-9-]*([.:-][a-z0-9-]+)*$'::text)),
    CONSTRAINT organization_permission_bundle_entries_type_check CHECK ((permission_type = ANY (ARRAY['module'::text, 'service'::text])))
);



CREATE TABLE public.organization_permission_bundles (
    bundle_id uuid DEFAULT gen_random_uuid() NOT NULL,
    deployment_id smallint DEFAULT 1 NOT NULL,
    organization_version bigint NOT NULL,
    name text NOT NULL,
    created_by_user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT organization_permission_bundles_name_check CHECK (((name = TRIM(BOTH FROM name)) AND ((length(name) >= 1) AND (length(name) <= 100))))
);



CREATE TABLE public.organization_role_grants (
    grant_id uuid DEFAULT gen_random_uuid() NOT NULL,
    deployment_id smallint DEFAULT 1 NOT NULL,
    organization_version bigint NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    granted_by_user_id uuid NOT NULL,
    reason text NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    revoked_by_user_id uuid,
    revocation_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT organization_role_grants_reason_check CHECK ((length(TRIM(BOTH FROM reason)) > 0)),
    CONSTRAINT organization_role_grants_revocation_check CHECK ((((revoked_at IS NULL) AND (revoked_by_user_id IS NULL) AND (revocation_reason IS NULL)) OR ((revoked_at IS NOT NULL) AND (length(TRIM(BOTH FROM revocation_reason)) > 0) AND (revoked_at >= granted_at)))),
    CONSTRAINT organization_role_grants_role_check CHECK ((role = ANY (ARRAY['hr_auditor'::text, 'director'::text, 'organization_owner'::text])))
);



CREATE TABLE public.platform_collection_state (
    module_id text NOT NULL,
    resource_id text NOT NULL,
    subject_kind text NOT NULL,
    subject_lifecycle_id uuid NOT NULL,
    subject_id text NOT NULL,
    next_eligible_at timestamp with time zone,
    authorization_generation integer,
    validated_at timestamp with time zone,
    last_failure_class text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    failure_started_at timestamp with time zone,
    CONSTRAINT platform_collection_state_authorization_generation_check CHECK (((authorization_generation IS NULL) OR (authorization_generation >= 0))),
    CONSTRAINT platform_collection_state_failure_started_at_check CHECK ((((last_failure_class IS NULL) AND (failure_started_at IS NULL)) OR ((last_failure_class IS NOT NULL) AND (failure_started_at IS NOT NULL)))),
    CONSTRAINT platform_collection_state_last_failure_class_check CHECK (((last_failure_class IS NULL) OR (last_failure_class = ANY (ARRAY['authorization-required'::text, 'esi-cooldown'::text, 'esi-unavailable'::text, 'response-invalid'::text, 'mapping-failed'::text, 'persistence-failed'::text, 'unknown'::text])))),
    CONSTRAINT platform_collection_state_module_id_check CHECK (((module_id = 'core'::text) OR (public.is_valid_module_id(module_id) AND (length(module_id) <= 44) AND (module_id <> 'platform'::text)))),
    CONSTRAINT platform_collection_state_resource_id_check CHECK (public.is_valid_platform_identifier(resource_id)),
    CONSTRAINT platform_collection_state_subject_id_check CHECK (((subject_id <> ''::text) AND (subject_id = TRIM(BOTH FROM subject_id)))),
    CONSTRAINT platform_collection_state_subject_kind_check CHECK (((subject_kind = ANY (ARRAY['deployment'::text, 'corporation'::text, 'alliance'::text])) OR public.is_character_subject_kind(subject_kind)))
);



CREATE TABLE public.platform_subject_lifecycles (
    subject_lifecycle_id uuid DEFAULT gen_random_uuid() NOT NULL,
    subject_kind text NOT NULL,
    subject_id text NOT NULL,
    character_id bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    organization_deployment_id smallint,
    organization_version bigint,
    corporation_source_id uuid,
    CONSTRAINT platform_subject_lifecycles_binding_check CHECK (((public.is_character_subject_kind(subject_kind) AND (character_id IS NOT NULL) AND (subject_id = (character_id)::text) AND (organization_deployment_id IS NULL) AND (organization_version IS NULL) AND (corporation_source_id IS NULL)) OR ((subject_kind = 'alliance'::text) AND (character_id IS NULL) AND (organization_deployment_id IS NOT NULL) AND (organization_version IS NOT NULL) AND (corporation_source_id IS NULL)) OR ((subject_kind = 'corporation'::text) AND (character_id IS NULL) AND (organization_deployment_id IS NULL) AND (organization_version IS NULL) AND (corporation_source_id IS NOT NULL)) OR ((subject_kind = 'deployment'::text) AND (character_id IS NULL) AND (subject_id = (organization_deployment_id)::text) AND (organization_deployment_id IS NOT NULL) AND (organization_version IS NOT NULL) AND (corporation_source_id IS NULL)))),
    CONSTRAINT platform_subject_lifecycles_subject_id_check CHECK (((subject_id <> ''::text) AND (subject_id = TRIM(BOTH FROM subject_id)))),
    CONSTRAINT platform_subject_lifecycles_subject_kind_check CHECK (((subject_kind = ANY (ARRAY['deployment'::text, 'corporation'::text, 'alliance'::text])) OR public.is_character_subject_kind(subject_kind)))
);



CREATE TABLE public.sde_ancestries (
    ancestry_id bigint NOT NULL,
    bloodline_id bigint,
    name text NOT NULL,
    short_description text
);



CREATE TABLE public.sde_bloodlines (
    bloodline_id bigint NOT NULL,
    race_id bigint,
    name text NOT NULL,
    description text
);



CREATE TABLE public.sde_builds (
    build_number bigint NOT NULL,
    release_date timestamp with time zone NOT NULL,
    ingested_at timestamp with time zone DEFAULT now() NOT NULL,
    ingest_version integer DEFAULT 1 NOT NULL
);



CREATE TABLE public.sde_categories (
    category_id bigint NOT NULL,
    name text NOT NULL,
    published boolean NOT NULL
);



CREATE TABLE public.sde_dataset_rows (
    dataset text NOT NULL,
    key text NOT NULL,
    data jsonb NOT NULL
);



CREATE TABLE public.sde_dogma_attributes (
    attribute_id bigint NOT NULL,
    name text NOT NULL,
    description text,
    default_value double precision,
    published boolean NOT NULL,
    high_is_good boolean NOT NULL,
    stackable boolean NOT NULL
);



CREATE TABLE public.sde_dogma_effects (
    effect_id bigint NOT NULL,
    name text NOT NULL,
    effect_category_id integer NOT NULL,
    published boolean NOT NULL,
    is_offensive boolean NOT NULL,
    is_assistance boolean NOT NULL,
    is_warp_safe boolean NOT NULL
);



CREATE TABLE public.sde_factions (
    faction_id bigint NOT NULL,
    name text NOT NULL,
    description text
);



CREATE TABLE public.sde_groups (
    group_id bigint NOT NULL,
    category_id bigint NOT NULL,
    name text NOT NULL,
    published boolean NOT NULL
);



CREATE TABLE public.sde_market_groups (
    market_group_id bigint NOT NULL,
    parent_group_id bigint,
    name text NOT NULL,
    description text
);



CREATE TABLE public.sde_npc_stations (
    station_id bigint NOT NULL,
    solar_system_id bigint NOT NULL
);



CREATE TABLE public.sde_projection_state (
    singleton boolean DEFAULT true NOT NULL,
    active_build_number bigint,
    CONSTRAINT sde_projection_state_singleton_check CHECK (singleton)
);



CREATE TABLE public.sde_races (
    race_id bigint NOT NULL,
    name text NOT NULL,
    description text
);



CREATE TABLE public.sde_solar_systems (
    solar_system_id bigint NOT NULL,
    name text NOT NULL,
    security_status double precision NOT NULL,
    CONSTRAINT sde_solar_systems_security_status_check CHECK (((security_status >= ('-1'::integer)::double precision) AND (security_status <= (1)::double precision)))
);



CREATE TABLE public.sde_type_dogma_attributes (
    type_id bigint NOT NULL,
    attribute_id bigint NOT NULL,
    value double precision NOT NULL
);



CREATE TABLE public.sde_type_dogma_effects (
    type_id bigint NOT NULL,
    effect_id bigint NOT NULL,
    is_default boolean NOT NULL
);



CREATE TABLE public.sde_types (
    type_id bigint NOT NULL,
    group_id bigint NOT NULL,
    race_id bigint,
    market_group_id bigint,
    name text NOT NULL,
    published boolean NOT NULL,
    mass double precision,
    volume double precision,
    capacity double precision,
    portion_size integer,
    base_price double precision,
    description text
);



CREATE TABLE public.sessions (
    session_hash character varying(64) NOT NULL,
    user_id uuid NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sessions_session_hash_length_check CHECK ((length((session_hash)::text) = 64))
);



CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);



ALTER TABLE ONLY public.admin_sessions
    ADD CONSTRAINT admin_sessions_pkey PRIMARY KEY (session_hash);



ALTER TABLE ONLY public.character_transfer_approvals
    ADD CONSTRAINT character_transfer_approvals_link_secret_hash_key UNIQUE (link_secret_hash);



ALTER TABLE ONLY public.character_transfer_approvals
    ADD CONSTRAINT character_transfer_approvals_pkey PRIMARY KEY (approval_id);



ALTER TABLE ONLY public.character_transfer_audit
    ADD CONSTRAINT character_transfer_audit_pkey PRIMARY KEY (audit_id);



ALTER TABLE ONLY public.character_transfer_previews
    ADD CONSTRAINT character_transfer_previews_pkey PRIMARY KEY (preview_id);



ALTER TABLE ONLY public.characters
    ADD CONSTRAINT characters_pkey PRIMARY KEY (character_id);



ALTER TABLE ONLY public.deployment_admins
    ADD CONSTRAINT deployment_admins_email_key UNIQUE (email);



ALTER TABLE ONLY public.deployment_admins
    ADD CONSTRAINT deployment_admins_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.deployment_installation_settings
    ADD CONSTRAINT deployment_installation_settings_owner_admin_id_key UNIQUE (owner_admin_id);



ALTER TABLE ONLY public.deployment_installation_settings
    ADD CONSTRAINT deployment_installation_settings_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.deployment_modules
    ADD CONSTRAINT deployment_modules_pkey PRIMARY KEY (module_id);



ALTER TABLE ONLY public.deployment_settings
    ADD CONSTRAINT deployment_settings_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.deployment_shell_navigation_order
    ADD CONSTRAINT deployment_shell_navigation_order_pkey PRIMARY KEY (owner_id, navigation_id);



ALTER TABLE ONLY public.domain_events
    ADD CONSTRAINT domain_events_event_sequence_key UNIQUE (event_sequence);



ALTER TABLE ONLY public.domain_events
    ADD CONSTRAINT domain_events_pkey PRIMARY KEY (event_id);



ALTER TABLE ONLY public.eve_tokens
    ADD CONSTRAINT eve_tokens_pkey PRIMARY KEY (character_id);



ALTER TABLE ONLY public.module_persistence_contract
    ADD CONSTRAINT module_persistence_contract_pkey PRIMARY KEY (singleton);



ALTER TABLE ONLY public.module_persistence_operation_attestations
    ADD CONSTRAINT module_persistence_operation_attestations_pkey PRIMARY KEY (module_id, operation_id);



ALTER TABLE ONLY public.module_schema_provisioning
    ADD CONSTRAINT module_schema_provisioning_pkey PRIMARY KEY (module_id);



ALTER TABLE ONLY public.oauth_states
    ADD CONSTRAINT oauth_states_pkey PRIMARY KEY (state_hash);



ALTER TABLE ONLY public.organization_account_compliance
    ADD CONSTRAINT organization_account_compliance_pkey PRIMARY KEY (deployment_id, organization_version, user_id);



ALTER TABLE ONLY public.organization_audit_events
    ADD CONSTRAINT organization_audit_events_pkey PRIMARY KEY (audit_id);



ALTER TABLE ONLY public.organization_audit_events
    ADD CONSTRAINT organization_audit_events_sequence_key UNIQUE (audit_sequence);



ALTER TABLE ONLY public.organization_authority_evidence
    ADD CONSTRAINT organization_authority_evidence_grant_key UNIQUE (grant_id);



ALTER TABLE ONLY public.organization_authority_evidence
    ADD CONSTRAINT organization_authority_evidence_pkey PRIMARY KEY (evidence_id);



ALTER TABLE ONLY public.organization_character_exceptions
    ADD CONSTRAINT organization_character_exceptions_pkey PRIMARY KEY (exception_id);



ALTER TABLE ONLY public.organization_character_exceptions
    ADD CONSTRAINT organization_character_exceptions_version_key UNIQUE (exception_id, deployment_id, organization_version);



ALTER TABLE ONLY public.organization_compliance_issues
    ADD CONSTRAINT organization_compliance_issues_pkey PRIMARY KEY (issue_id);



ALTER TABLE ONLY public.organization_compliance_issues
    ADD CONSTRAINT organization_compliance_issues_projection_key UNIQUE (deployment_id, organization_version, user_id, issue_key);



ALTER TABLE ONLY public.organization_corporation_roster_observations
    ADD CONSTRAINT organization_corporation_roster_observations_pkey PRIMARY KEY (deployment_id, organization_version, corporation_id, character_id);



ALTER TABLE ONLY public.organization_corporation_sources
    ADD CONSTRAINT organization_corporation_sources_pkey PRIMARY KEY (source_id);



ALTER TABLE ONLY public.organization_corporation_sources
    ADD CONSTRAINT organization_corporation_sources_source_version_key UNIQUE (source_id, deployment_id, organization_version, corporation_id);



ALTER TABLE ONLY public.organization_epochs
    ADD CONSTRAINT organization_epochs_identity_key UNIQUE (deployment_id, organization_version, organization_id);



ALTER TABLE ONLY public.organization_epochs
    ADD CONSTRAINT organization_epochs_pkey PRIMARY KEY (deployment_id, organization_version);



ALTER TABLE ONLY public.organization_group_assignments
    ADD CONSTRAINT organization_group_assignments_pkey PRIMARY KEY (assignment_id);



ALTER TABLE ONLY public.organization_group_assignments
    ADD CONSTRAINT organization_group_assignments_version_key UNIQUE (assignment_id, deployment_id, organization_version);



ALTER TABLE ONLY public.organization_group_permission_bundles
    ADD CONSTRAINT organization_group_permission_bundles_pkey PRIMARY KEY (group_id, bundle_id);



ALTER TABLE ONLY public.organization_groups
    ADD CONSTRAINT organization_groups_pkey PRIMARY KEY (group_id);



ALTER TABLE ONLY public.organization_groups
    ADD CONSTRAINT organization_groups_version_key UNIQUE (group_id, deployment_id, organization_version);



ALTER TABLE ONLY public.organization_managed_corporations
    ADD CONSTRAINT organization_managed_corporations_pkey PRIMARY KEY (deployment_id, organization_version, corporation_id);



ALTER TABLE ONLY public.organization_member_blocks
    ADD CONSTRAINT organization_member_blocks_pkey PRIMARY KEY (block_id);



ALTER TABLE ONLY public.organization_member_blocks
    ADD CONSTRAINT organization_member_blocks_version_key UNIQUE (block_id, deployment_id, organization_version, user_id);



ALTER TABLE ONLY public.organization_permission_bundle_entries
    ADD CONSTRAINT organization_permission_bundle_entries_pkey PRIMARY KEY (bundle_id, permission_type, permission_key);



ALTER TABLE ONLY public.organization_permission_bundles
    ADD CONSTRAINT organization_permission_bundles_pkey PRIMARY KEY (bundle_id);



ALTER TABLE ONLY public.organization_permission_bundles
    ADD CONSTRAINT organization_permission_bundles_version_key UNIQUE (bundle_id, deployment_id, organization_version);



ALTER TABLE ONLY public.organization_role_grants
    ADD CONSTRAINT organization_role_grants_pkey PRIMARY KEY (grant_id);



ALTER TABLE ONLY public.organization_role_grants
    ADD CONSTRAINT organization_role_grants_version_identity_key UNIQUE (grant_id, deployment_id, organization_version, user_id, role);



ALTER TABLE ONLY public.platform_collection_state
    ADD CONSTRAINT platform_collection_state_pkey PRIMARY KEY (module_id, resource_id, subject_kind, subject_lifecycle_id, subject_id);



ALTER TABLE ONLY public.platform_subject_lifecycles
    ADD CONSTRAINT platform_subject_lifecycles_character_id_key UNIQUE (character_id);



ALTER TABLE ONLY public.platform_subject_lifecycles
    ADD CONSTRAINT platform_subject_lifecycles_corporation_source_id_key UNIQUE (corporation_source_id);



ALTER TABLE ONLY public.platform_subject_lifecycles
    ADD CONSTRAINT platform_subject_lifecycles_organization_epoch_key UNIQUE (subject_kind, organization_deployment_id, organization_version);



ALTER TABLE ONLY public.platform_subject_lifecycles
    ADD CONSTRAINT platform_subject_lifecycles_pkey PRIMARY KEY (subject_lifecycle_id);



ALTER TABLE ONLY public.platform_subject_lifecycles
    ADD CONSTRAINT platform_subject_lifecycles_subject_kind_subject_lifecycle__key UNIQUE (subject_kind, subject_lifecycle_id, subject_id);



ALTER TABLE ONLY public.sde_ancestries
    ADD CONSTRAINT sde_ancestries_pkey PRIMARY KEY (ancestry_id);



ALTER TABLE ONLY public.sde_bloodlines
    ADD CONSTRAINT sde_bloodlines_pkey PRIMARY KEY (bloodline_id);



ALTER TABLE ONLY public.sde_builds
    ADD CONSTRAINT sde_builds_pkey PRIMARY KEY (build_number);



ALTER TABLE ONLY public.sde_categories
    ADD CONSTRAINT sde_categories_pkey PRIMARY KEY (category_id);



ALTER TABLE ONLY public.sde_dataset_rows
    ADD CONSTRAINT sde_dataset_rows_pkey PRIMARY KEY (dataset, key);



ALTER TABLE ONLY public.sde_dogma_attributes
    ADD CONSTRAINT sde_dogma_attributes_pkey PRIMARY KEY (attribute_id);



ALTER TABLE ONLY public.sde_dogma_effects
    ADD CONSTRAINT sde_dogma_effects_pkey PRIMARY KEY (effect_id);



ALTER TABLE ONLY public.sde_factions
    ADD CONSTRAINT sde_factions_pkey PRIMARY KEY (faction_id);



ALTER TABLE ONLY public.sde_groups
    ADD CONSTRAINT sde_groups_pkey PRIMARY KEY (group_id);



ALTER TABLE ONLY public.sde_market_groups
    ADD CONSTRAINT sde_market_groups_pkey PRIMARY KEY (market_group_id);



ALTER TABLE ONLY public.sde_npc_stations
    ADD CONSTRAINT sde_npc_stations_pkey PRIMARY KEY (station_id);



ALTER TABLE ONLY public.sde_projection_state
    ADD CONSTRAINT sde_projection_state_pkey PRIMARY KEY (singleton);



ALTER TABLE ONLY public.sde_races
    ADD CONSTRAINT sde_races_pkey PRIMARY KEY (race_id);



ALTER TABLE ONLY public.sde_solar_systems
    ADD CONSTRAINT sde_solar_systems_pkey PRIMARY KEY (solar_system_id);



ALTER TABLE ONLY public.sde_type_dogma_attributes
    ADD CONSTRAINT sde_type_dogma_attributes_pkey PRIMARY KEY (type_id, attribute_id);



ALTER TABLE ONLY public.sde_type_dogma_effects
    ADD CONSTRAINT sde_type_dogma_effects_pkey PRIMARY KEY (type_id, effect_id);



ALTER TABLE ONLY public.sde_types
    ADD CONSTRAINT sde_types_pkey PRIMARY KEY (type_id);



ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (session_hash);



ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);



CREATE INDEX admin_sessions_admin_id_idx ON public.admin_sessions USING btree (admin_id);



CREATE INDEX admin_sessions_expires_at_idx ON public.admin_sessions USING btree (expires_at);



CREATE INDEX character_transfer_approvals_character_lifecycle_idx ON public.character_transfer_approvals USING btree (character_id, source_subject_lifecycle_id);



CREATE INDEX character_transfer_approvals_destination_user_id_idx ON public.character_transfer_approvals USING btree (destination_user_id);



CREATE INDEX character_transfer_approvals_pending_idx ON public.character_transfer_approvals USING btree (expires_at, approval_id) WHERE ((consumed_at IS NULL) AND (revoked_at IS NULL));



CREATE INDEX character_transfer_audit_approval_id_idx ON public.character_transfer_audit USING btree (approval_id, occurred_at);



CREATE INDEX character_transfer_audit_character_id_idx ON public.character_transfer_audit USING btree (character_id, occurred_at);



CREATE INDEX character_transfer_previews_administrator_id_idx ON public.character_transfer_previews USING btree (administrator_id);



CREATE INDEX character_transfer_previews_expires_at_idx ON public.character_transfer_previews USING btree (expires_at);



CREATE INDEX characters_due_affiliation_check_idx ON public.characters USING btree (next_affiliation_check, character_id) WHERE ((next_affiliation_check IS NOT NULL) AND (affiliation_resolution_state <> 'unresolvable'::text));



CREATE UNIQUE INDEX characters_user_character_key ON public.characters USING btree (user_id, character_id);



CREATE INDEX domain_events_pending_eligible_idx ON public.domain_events USING btree (next_attempt_at, event_sequence) WHERE (published_at IS NULL);



CREATE INDEX domain_events_published_retention_idx ON public.domain_events USING btree (published_at) WHERE (published_at IS NOT NULL);



CREATE INDEX oauth_states_character_id_idx ON public.oauth_states USING btree (character_id) WHERE (character_id IS NOT NULL);



CREATE INDEX oauth_states_expires_at_idx ON public.oauth_states USING btree (expires_at);



CREATE INDEX oauth_states_organization_epoch_idx ON public.oauth_states USING btree (organization_deployment_id, organization_version) WHERE (organization_deployment_id IS NOT NULL);



CREATE INDEX oauth_states_transfer_approval_idx ON public.oauth_states USING btree (transfer_approval_id) WHERE (transfer_approval_id IS NOT NULL);



CREATE INDEX oauth_states_user_id_idx ON public.oauth_states USING btree (user_id) WHERE (user_id IS NOT NULL);



CREATE UNIQUE INDEX one_main_character_per_user ON public.characters USING btree (user_id) WHERE is_main;



CREATE INDEX organization_account_compliance_access_expiry_idx ON public.organization_account_compliance USING btree (access_valid_until, user_id) WHERE (authoritative AND (access_valid_until IS NOT NULL));



CREATE INDEX organization_account_compliance_authoritative_idx ON public.organization_account_compliance USING btree (deployment_id, organization_version, user_id) WHERE authoritative;



CREATE INDEX organization_account_compliance_repair_idx ON public.organization_account_compliance USING btree (deployment_id, organization_version, evaluated_at, user_id);



CREATE INDEX organization_audit_events_subject_idx ON public.organization_audit_events USING btree (deployment_id, organization_version, subject_type, subject_id, audit_sequence);



CREATE INDEX organization_audit_events_version_sequence_idx ON public.organization_audit_events USING btree (deployment_id, organization_version, audit_sequence);



CREATE INDEX organization_authority_evidence_refresh_idx ON public.organization_authority_evidence USING btree (status, last_checked_at, grant_id);



CREATE INDEX organization_character_exceptions_expiry_idx ON public.organization_character_exceptions USING btree (expires_at, exception_id) WHERE ((revoked_at IS NULL) AND (expired_at IS NULL) AND (expires_at IS NOT NULL));



CREATE INDEX organization_character_exceptions_subject_idx ON public.organization_character_exceptions USING btree (deployment_id, organization_version, user_id, character_id, expires_at) WHERE (revoked_at IS NULL);



CREATE INDEX organization_compliance_issues_character_idx ON public.organization_compliance_issues USING btree (character_id) WHERE (character_id IS NOT NULL);



CREATE INDEX organization_corporation_roster_source_idx ON public.organization_corporation_roster_observations USING btree (source_id);



CREATE UNIQUE INDEX organization_corporation_sources_active_key ON public.organization_corporation_sources USING btree (deployment_id, organization_version, corporation_id) WHERE (revoked_at IS NULL);



CREATE INDEX organization_corporation_sources_character_idx ON public.organization_corporation_sources USING btree (character_id) WHERE (revoked_at IS NULL);



CREATE UNIQUE INDEX organization_group_assignments_active_key ON public.organization_group_assignments USING btree (deployment_id, organization_version, group_id, user_id) WHERE (revoked_at IS NULL);



CREATE INDEX organization_group_assignments_entitlement_idx ON public.organization_group_assignments USING btree (deployment_id, organization_version, user_id, expires_at, group_id) WHERE (revoked_at IS NULL);



CREATE INDEX organization_groups_compliance_source_idx ON public.organization_groups USING btree (deployment_id, organization_version, compliance_source) WHERE (management_mode = 'compliance'::text);



CREATE UNIQUE INDEX organization_groups_name_key ON public.organization_groups USING btree (deployment_id, organization_version, lower(name));



CREATE INDEX organization_managed_corporations_current_idx ON public.organization_managed_corporations USING btree (deployment_id, organization_version, corporation_id) WHERE is_current;



CREATE UNIQUE INDEX organization_member_blocks_active_key ON public.organization_member_blocks USING btree (deployment_id, organization_version, user_id) WHERE (unblocked_at IS NULL);



CREATE INDEX organization_member_blocks_active_subject_idx ON public.organization_member_blocks USING btree (user_id, deployment_id, organization_version) WHERE (unblocked_at IS NULL);



CREATE UNIQUE INDEX organization_permission_bundles_name_key ON public.organization_permission_bundles USING btree (deployment_id, organization_version, lower(name));



CREATE UNIQUE INDEX organization_role_grants_active_key ON public.organization_role_grants USING btree (deployment_id, organization_version, user_id, role) WHERE (revoked_at IS NULL);



CREATE INDEX organization_role_grants_active_role_idx ON public.organization_role_grants USING btree (deployment_id, organization_version, role, user_id) WHERE (revoked_at IS NULL);



CREATE INDEX platform_collection_state_due_idx ON public.platform_collection_state USING btree (next_eligible_at, module_id, resource_id, subject_kind, subject_lifecycle_id, subject_id) WHERE (next_eligible_at IS NOT NULL);



CREATE INDEX platform_collection_state_subject_lifecycle_idx ON public.platform_collection_state USING btree (subject_kind, subject_lifecycle_id, subject_id);



CREATE INDEX sde_ancestries_bloodline_id_idx ON public.sde_ancestries USING btree (bloodline_id);



CREATE INDEX sde_bloodlines_race_id_idx ON public.sde_bloodlines USING btree (race_id);



CREATE INDEX sde_dataset_rows_dataset_idx ON public.sde_dataset_rows USING btree (dataset);



CREATE INDEX sde_groups_category_id_idx ON public.sde_groups USING btree (category_id);



CREATE INDEX sde_market_groups_parent_group_id_idx ON public.sde_market_groups USING btree (parent_group_id);



CREATE INDEX sde_npc_stations_solar_system_id_idx ON public.sde_npc_stations USING btree (solar_system_id);



CREATE INDEX sde_types_group_id_idx ON public.sde_types USING btree (group_id);



CREATE INDEX sde_types_market_group_id_idx ON public.sde_types USING btree (market_group_id);



CREATE INDEX sessions_expires_at_idx ON public.sessions USING btree (expires_at);



CREATE INDEX sessions_user_id_idx ON public.sessions USING btree (user_id);



CREATE TRIGGER character_transfer_approvals_mutation_guard BEFORE UPDATE ON public.character_transfer_approvals FOR EACH ROW EXECUTE FUNCTION public.enforce_character_transfer_approval_mutation();



CREATE TRIGGER character_transfer_audit_append_only BEFORE DELETE OR UPDATE ON public.character_transfer_audit FOR EACH ROW EXECUTE FUNCTION public.prevent_character_transfer_audit_mutation();



CREATE TRIGGER domain_events_immutable_envelope BEFORE UPDATE ON public.domain_events FOR EACH ROW EXECUTE FUNCTION public.prevent_domain_event_envelope_update();



CREATE TRIGGER organization_audit_events_append_only BEFORE DELETE OR UPDATE ON public.organization_audit_events FOR EACH ROW EXECUTE FUNCTION public.prevent_organization_audit_mutation();



CREATE TRIGGER organization_authority_evidence_character_owner_trigger BEFORE INSERT OR UPDATE OF user_id, character_id ON public.organization_authority_evidence FOR EACH ROW EXECUTE FUNCTION public.validate_organization_authority_evidence_character_owner();



CREATE TRIGGER organization_group_assignments_management_guard BEFORE INSERT OR UPDATE OF group_id, deployment_id, organization_version, assignment_source, compliance_source ON public.organization_group_assignments FOR EACH ROW EXECUTE FUNCTION public.enforce_organization_group_assignment_management();



CREATE TRIGGER organization_groups_management_change_guard BEFORE UPDATE OF management_mode, compliance_source ON public.organization_groups FOR EACH ROW EXECUTE FUNCTION public.prevent_organization_group_management_change();



ALTER TABLE ONLY public.admin_sessions
    ADD CONSTRAINT admin_sessions_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.deployment_admins(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.character_transfer_previews
    ADD CONSTRAINT character_transfer_previews_administrator_id_fkey FOREIGN KEY (administrator_id) REFERENCES public.deployment_admins(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.character_transfer_previews
    ADD CONSTRAINT character_transfer_previews_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters(character_id) ON DELETE CASCADE;



ALTER TABLE ONLY public.character_transfer_previews
    ADD CONSTRAINT character_transfer_previews_destination_main_character_id_fkey FOREIGN KEY (destination_main_character_id) REFERENCES public.characters(character_id) ON DELETE CASCADE;



ALTER TABLE ONLY public.character_transfer_previews
    ADD CONSTRAINT character_transfer_previews_destination_user_id_fkey FOREIGN KEY (destination_user_id) REFERENCES public.users(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.character_transfer_previews
    ADD CONSTRAINT character_transfer_previews_source_subject_lifecycle_id_fkey FOREIGN KEY (source_subject_lifecycle_id) REFERENCES public.platform_subject_lifecycles(subject_lifecycle_id) ON DELETE CASCADE;



ALTER TABLE ONLY public.character_transfer_previews
    ADD CONSTRAINT character_transfer_previews_source_user_id_fkey FOREIGN KEY (source_user_id) REFERENCES public.users(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.characters
    ADD CONSTRAINT characters_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.deployment_installation_settings
    ADD CONSTRAINT deployment_installation_settings_owner_admin_id_fkey FOREIGN KEY (owner_admin_id) REFERENCES public.deployment_admins(id) ON DELETE RESTRICT;



ALTER TABLE ONLY public.deployment_settings
    ADD CONSTRAINT deployment_settings_organization_epoch_fkey FOREIGN KEY (id, organization_version) REFERENCES public.organization_epochs(deployment_id, organization_version) ON DELETE RESTRICT;



ALTER TABLE ONLY public.eve_tokens
    ADD CONSTRAINT eve_tokens_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters(character_id) ON DELETE CASCADE;



ALTER TABLE ONLY public.oauth_states
    ADD CONSTRAINT oauth_states_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters(character_id) ON DELETE CASCADE;



ALTER TABLE ONLY public.oauth_states
    ADD CONSTRAINT oauth_states_organization_epoch_fkey FOREIGN KEY (organization_deployment_id, organization_version, organization_id) REFERENCES public.organization_epochs(deployment_id, organization_version, organization_id) ON DELETE CASCADE;



ALTER TABLE ONLY public.oauth_states
    ADD CONSTRAINT oauth_states_transfer_approval_fkey FOREIGN KEY (transfer_approval_id) REFERENCES public.character_transfer_approvals(approval_id) ON DELETE CASCADE;



ALTER TABLE ONLY public.oauth_states
    ADD CONSTRAINT oauth_states_transfer_source_lifecycle_fkey FOREIGN KEY (transfer_source_subject_lifecycle_id) REFERENCES public.platform_subject_lifecycles(subject_lifecycle_id) ON DELETE CASCADE;



ALTER TABLE ONLY public.oauth_states
    ADD CONSTRAINT oauth_states_transfer_source_user_fkey FOREIGN KEY (transfer_source_user_id) REFERENCES public.users(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.oauth_states
    ADD CONSTRAINT oauth_states_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.organization_account_compliance
    ADD CONSTRAINT organization_account_compliance_epoch_fkey FOREIGN KEY (deployment_id, organization_version) REFERENCES public.organization_epochs(deployment_id, organization_version) ON DELETE RESTRICT;



ALTER TABLE ONLY public.organization_account_compliance
    ADD CONSTRAINT organization_account_compliance_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.organization_audit_events
    ADD CONSTRAINT organization_audit_events_causation_fkey FOREIGN KEY (causation_audit_id) REFERENCES public.organization_audit_events(audit_id) ON DELETE RESTRICT;



ALTER TABLE ONLY public.organization_audit_events
    ADD CONSTRAINT organization_audit_events_epoch_fkey FOREIGN KEY (deployment_id, organization_version) REFERENCES public.organization_epochs(deployment_id, organization_version) ON DELETE RESTRICT;



ALTER TABLE ONLY public.organization_authority_evidence
    ADD CONSTRAINT organization_authority_evidence_grant_fkey FOREIGN KEY (grant_id, deployment_id, organization_version, user_id, role) REFERENCES public.organization_role_grants(grant_id, deployment_id, organization_version, user_id, role) ON DELETE RESTRICT;



ALTER TABLE ONLY public.organization_character_exceptions
    ADD CONSTRAINT organization_character_exceptions_approver_user_id_fkey FOREIGN KEY (approver_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;



ALTER TABLE ONLY public.organization_character_exceptions
    ADD CONSTRAINT organization_character_exceptions_character_owner_fkey FOREIGN KEY (user_id, character_id) REFERENCES public.characters(user_id, character_id) ON DELETE CASCADE;



ALTER TABLE ONLY public.organization_character_exceptions
    ADD CONSTRAINT organization_character_exceptions_epoch_fkey FOREIGN KEY (deployment_id, organization_version) REFERENCES public.organization_epochs(deployment_id, organization_version) ON DELETE RESTRICT;



ALTER TABLE ONLY public.organization_character_exceptions
    ADD CONSTRAINT organization_character_exceptions_revoked_by_user_id_fkey FOREIGN KEY (revoked_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;



ALTER TABLE ONLY public.organization_compliance_issues
    ADD CONSTRAINT organization_compliance_issues_character_owner_fkey FOREIGN KEY (user_id, character_id) REFERENCES public.characters(user_id, character_id) ON DELETE CASCADE;



ALTER TABLE ONLY public.organization_compliance_issues
    ADD CONSTRAINT organization_compliance_issues_projection_fkey FOREIGN KEY (deployment_id, organization_version, user_id) REFERENCES public.organization_account_compliance(deployment_id, organization_version, user_id) ON DELETE CASCADE;



ALTER TABLE ONLY public.organization_corporation_roster_observations
    ADD CONSTRAINT organization_corporation_roster_source_fkey FOREIGN KEY (source_id, deployment_id, organization_version, corporation_id) REFERENCES public.organization_corporation_sources(source_id, deployment_id, organization_version, corporation_id) ON DELETE RESTRICT;



ALTER TABLE ONLY public.organization_corporation_sources
    ADD CONSTRAINT organization_corporation_sources_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters(character_id) ON DELETE SET NULL;



ALTER TABLE ONLY public.organization_corporation_sources
    ADD CONSTRAINT organization_corporation_sources_managed_corporation_fkey FOREIGN KEY (deployment_id, organization_version, corporation_id) REFERENCES public.organization_managed_corporations(deployment_id, organization_version, corporation_id) ON DELETE RESTRICT;



ALTER TABLE ONLY public.organization_corporation_sources
    ADD CONSTRAINT organization_corporation_sources_registered_by_user_id_fkey FOREIGN KEY (registered_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;



ALTER TABLE ONLY public.organization_corporation_sources
    ADD CONSTRAINT organization_corporation_sources_revoked_by_user_id_fkey FOREIGN KEY (revoked_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;



ALTER TABLE ONLY public.organization_group_assignments
    ADD CONSTRAINT organization_group_assignments_assigned_by_fkey FOREIGN KEY (assigned_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;



ALTER TABLE ONLY public.organization_group_assignments
    ADD CONSTRAINT organization_group_assignments_group_fkey FOREIGN KEY (group_id, deployment_id, organization_version) REFERENCES public.organization_groups(group_id, deployment_id, organization_version) ON DELETE RESTRICT;



ALTER TABLE ONLY public.organization_group_assignments
    ADD CONSTRAINT organization_group_assignments_revoked_by_fkey FOREIGN KEY (revoked_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;



ALTER TABLE ONLY public.organization_group_assignments
    ADD CONSTRAINT organization_group_assignments_user_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.organization_group_permission_bundles
    ADD CONSTRAINT organization_group_permission_bundles_bundle_fkey FOREIGN KEY (bundle_id, deployment_id, organization_version) REFERENCES public.organization_permission_bundles(bundle_id, deployment_id, organization_version) ON DELETE RESTRICT;



ALTER TABLE ONLY public.organization_group_permission_bundles
    ADD CONSTRAINT organization_group_permission_bundles_group_fkey FOREIGN KEY (group_id, deployment_id, organization_version) REFERENCES public.organization_groups(group_id, deployment_id, organization_version) ON DELETE RESTRICT;



ALTER TABLE ONLY public.organization_groups
    ADD CONSTRAINT organization_groups_creator_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;



ALTER TABLE ONLY public.organization_groups
    ADD CONSTRAINT organization_groups_epoch_fkey FOREIGN KEY (deployment_id, organization_version) REFERENCES public.organization_epochs(deployment_id, organization_version) ON DELETE RESTRICT;



ALTER TABLE ONLY public.organization_managed_corporations
    ADD CONSTRAINT organization_managed_corporations_epoch_fkey FOREIGN KEY (deployment_id, organization_version) REFERENCES public.organization_epochs(deployment_id, organization_version) ON DELETE RESTRICT;



ALTER TABLE ONLY public.organization_member_blocks
    ADD CONSTRAINT organization_member_blocks_blocked_by_user_id_fkey FOREIGN KEY (blocked_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;



ALTER TABLE ONLY public.organization_member_blocks
    ADD CONSTRAINT organization_member_blocks_epoch_fkey FOREIGN KEY (deployment_id, organization_version) REFERENCES public.organization_epochs(deployment_id, organization_version) ON DELETE RESTRICT;



ALTER TABLE ONLY public.organization_member_blocks
    ADD CONSTRAINT organization_member_blocks_unblocked_by_user_id_fkey FOREIGN KEY (unblocked_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;



ALTER TABLE ONLY public.organization_member_blocks
    ADD CONSTRAINT organization_member_blocks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.organization_permission_bundle_entries
    ADD CONSTRAINT organization_permission_bundle_entries_bundle_fkey FOREIGN KEY (bundle_id, deployment_id, organization_version) REFERENCES public.organization_permission_bundles(bundle_id, deployment_id, organization_version) ON DELETE RESTRICT;



ALTER TABLE ONLY public.organization_permission_bundles
    ADD CONSTRAINT organization_permission_bundles_creator_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;



ALTER TABLE ONLY public.organization_permission_bundles
    ADD CONSTRAINT organization_permission_bundles_epoch_fkey FOREIGN KEY (deployment_id, organization_version) REFERENCES public.organization_epochs(deployment_id, organization_version) ON DELETE RESTRICT;



ALTER TABLE ONLY public.organization_role_grants
    ADD CONSTRAINT organization_role_grants_epoch_fkey FOREIGN KEY (deployment_id, organization_version) REFERENCES public.organization_epochs(deployment_id, organization_version) ON DELETE RESTRICT;



ALTER TABLE ONLY public.organization_role_grants
    ADD CONSTRAINT organization_role_grants_granted_by_user_id_fkey FOREIGN KEY (granted_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;



ALTER TABLE ONLY public.organization_role_grants
    ADD CONSTRAINT organization_role_grants_revoked_by_user_id_fkey FOREIGN KEY (revoked_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;



ALTER TABLE ONLY public.organization_role_grants
    ADD CONSTRAINT organization_role_grants_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.platform_collection_state
    ADD CONSTRAINT platform_collection_state_module_id_fkey FOREIGN KEY (module_id) REFERENCES public.deployment_modules(module_id) ON DELETE RESTRICT;



ALTER TABLE ONLY public.platform_collection_state
    ADD CONSTRAINT platform_collection_state_subject_lifecycle_fkey FOREIGN KEY (subject_kind, subject_lifecycle_id, subject_id) REFERENCES public.platform_subject_lifecycles(subject_kind, subject_lifecycle_id, subject_id) ON DELETE CASCADE;



ALTER TABLE ONLY public.platform_subject_lifecycles
    ADD CONSTRAINT platform_subject_lifecycles_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters(character_id) ON DELETE CASCADE;



ALTER TABLE ONLY public.platform_subject_lifecycles
    ADD CONSTRAINT platform_subject_lifecycles_corporation_source_id_fkey FOREIGN KEY (corporation_source_id) REFERENCES public.organization_corporation_sources(source_id) ON DELETE RESTRICT;



ALTER TABLE ONLY public.platform_subject_lifecycles
    ADD CONSTRAINT platform_subject_lifecycles_organization_epoch_fkey FOREIGN KEY (organization_deployment_id, organization_version) REFERENCES public.organization_epochs(deployment_id, organization_version) ON DELETE RESTRICT;



ALTER TABLE ONLY public.sde_npc_stations
    ADD CONSTRAINT sde_npc_stations_solar_system_id_fkey FOREIGN KEY (solar_system_id) REFERENCES public.sde_solar_systems(solar_system_id);



ALTER TABLE ONLY public.sde_projection_state
    ADD CONSTRAINT sde_projection_state_active_build_number_fkey FOREIGN KEY (active_build_number) REFERENCES public.sde_builds(build_number);



ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;



revoke all privileges on schema public from public;



REVOKE ALL ON FUNCTION public.enforce_character_transfer_approval_mutation() FROM PUBLIC;



REVOKE ALL ON FUNCTION public.enforce_organization_group_assignment_management() FROM PUBLIC;



REVOKE ALL ON FUNCTION public.is_character_subject_kind(value text) FROM PUBLIC;



REVOKE ALL ON FUNCTION public.is_valid_platform_identifier(value text) FROM PUBLIC;



REVOKE ALL ON FUNCTION public.is_valid_module_id(value text) FROM PUBLIC;



REVOKE ALL ON FUNCTION public.platform_classify_resources(resources jsonb, effective_at timestamp with time zone, filter_module_id text, filter_resource_id text, filter_subject_kind text, filter_subject_lifecycle_id uuid, filter_subject_id text) FROM PUBLIC;



REVOKE ALL ON FUNCTION public.prevent_character_transfer_audit_mutation() FROM PUBLIC;



REVOKE ALL ON FUNCTION public.prevent_organization_audit_mutation() FROM PUBLIC;



REVOKE ALL ON FUNCTION public.prevent_organization_group_management_change() FROM PUBLIC;



REVOKE ALL ON FUNCTION public.validate_organization_authority_evidence_character_owner() FROM PUBLIC;



alter default privileges revoke execute on routines from public;





insert into public.deployment_installation_settings (id) values (1);
insert into public.deployment_modules (module_id, enabled) values ('core', true);
insert into public.sde_projection_state (singleton, active_build_number) values (true, null);
