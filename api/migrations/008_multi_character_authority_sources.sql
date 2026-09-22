ALTER TABLE deployment_settings
  ADD COLUMN derived_director_authority_enabled boolean DEFAULT true NOT NULL,
  ADD COLUMN authority_evidence_fresh_duration_seconds integer DEFAULT 3600 NOT NULL,
  ADD CONSTRAINT deployment_settings_authority_evidence_fresh_duration_check CHECK (
    authority_evidence_fresh_duration_seconds BETWEEN 300 AND 86400
  );

ALTER TABLE characters
  ADD COLUMN owner_hash text;

UPDATE characters
SET owner_hash = 'legacy-unresolved:' || gen_random_uuid()::text;

ALTER TABLE characters
  ALTER COLUMN owner_hash SET NOT NULL,
  ADD CONSTRAINT characters_owner_hash_check CHECK (length(trim(owner_hash)) > 0);

CREATE UNIQUE INDEX organization_role_grants_active_owner_key
  ON organization_role_grants (deployment_id, organization_version)
  WHERE role = 'organization_owner' AND revoked_at IS NULL;

ALTER TABLE organization_authority_evidence
  DROP CONSTRAINT organization_authority_evidence_status_check,
  DROP CONSTRAINT organization_authority_evidence_verified_at_check,
  DROP CONSTRAINT organization_authority_evidence_review_check,
  DROP CONSTRAINT organization_authority_evidence_checked_at_check,
  ADD COLUMN source_subject_lifecycle_id uuid,
  ADD COLUMN authorization_generation integer,
  ADD COLUMN role_evidence_revision text,
  ADD COLUMN observed_at timestamp with time zone,
  ADD COLUMN fresh_until timestamp with time zone,
  ADD COLUMN grace_until timestamp with time zone,
  ADD COLUMN invalidated_at timestamp with time zone,
  ADD COLUMN invalidation_outcome text;

UPDATE organization_authority_evidence evidence
SET source_subject_lifecycle_id = COALESCE(
      (
        SELECT lifecycle.subject_lifecycle_id
        FROM platform_subject_lifecycles lifecycle
        WHERE lifecycle.character_id = evidence.character_id
          AND is_character_subject_kind(lifecycle.subject_kind)
      ),
      gen_random_uuid()
    ),
    authorization_generation = COALESCE(
      (SELECT token.token_version FROM eve_tokens token WHERE token.character_id = evidence.character_id),
      0
    ),
    role_evidence_revision = 'legacy-invalidated:' || evidence.evidence_id::text,
    observed_at = evidence.last_checked_at,
    fresh_until = evidence.last_checked_at + interval '1 microsecond',
    status = 'invalid',
    failure_class = 'strict:authorization-missing',
    invalidated_at = clock_timestamp(),
    invalidation_outcome = 'authorization-missing',
    updated_at = clock_timestamp();

ALTER TABLE organization_authority_evidence
  ALTER COLUMN director_role_present SET NOT NULL,
  ALTER COLUMN source_subject_lifecycle_id SET NOT NULL,
  ALTER COLUMN authorization_generation SET NOT NULL,
  ALTER COLUMN role_evidence_revision SET NOT NULL,
  ALTER COLUMN observed_at SET NOT NULL,
  ALTER COLUMN fresh_until SET NOT NULL,
  DROP COLUMN verified_at,
  DROP COLUMN review_deadline,
  ADD CONSTRAINT organization_authority_evidence_status_check CHECK (
    status IN ('fresh', 'degraded', 'invalid')
  ),
  ADD CONSTRAINT organization_authority_evidence_authorization_generation_check CHECK (
    authorization_generation >= 0
  ),
  ADD CONSTRAINT organization_authority_evidence_role_evidence_revision_check CHECK (
    length(trim(role_evidence_revision)) > 0
  ),
  ADD CONSTRAINT organization_authority_evidence_failure_class_check CHECK (
    failure_class IS NULL OR failure_class ~ '^(strict|transient):[a-z][a-z0-9-]{0,99}$'
  ),
  ADD CONSTRAINT organization_authority_evidence_invalidation_outcome_check CHECK (
    invalidation_outcome IS NULL OR invalidation_outcome IN (
      'affiliation-changed', 'authorization-generation-changed', 'authorization-missing',
      'authorization-rejected', 'authorization-revoked', 'blocked', 'detached', 'expired',
      'lifecycle-replaced', 'missing-scope', 'not-director', 'organization-replaced',
      'owner-mismatch', 'policy-disabled', 'source-replaced', 'transferred', 'wrong-alliance',
      'wrong-corporation'
    )
  ),
  ADD CONSTRAINT organization_authority_evidence_deadline_check CHECK (
    fresh_until > observed_at
    AND (grace_until IS NULL OR grace_until >= fresh_until)
  ),
  ADD CONSTRAINT organization_authority_evidence_checked_at_check CHECK (
    last_checked_at >= observed_at
  ),
  ADD CONSTRAINT organization_authority_evidence_state_check CHECK (
    (
      status = 'fresh'
      AND director_role_present
      AND failure_class IS NULL
      AND grace_until IS NULL
      AND invalidated_at IS NULL
      AND invalidation_outcome IS NULL
    ) OR (
      status = 'degraded'
      AND director_role_present
      AND failure_class IS NOT NULL
      AND grace_until IS NOT NULL
      AND invalidated_at IS NULL
      AND invalidation_outcome IS NULL
    ) OR (
      status = 'invalid'
      AND failure_class IS NOT NULL
      AND grace_until IS NULL
      AND invalidated_at IS NOT NULL
      AND invalidation_outcome IS NOT NULL
    )
  );

CREATE INDEX organization_authority_evidence_source_idx
  ON organization_authority_evidence (
    source_subject_lifecycle_id, authorization_generation, role_evidence_revision
  );

CREATE INDEX organization_authority_evidence_deadline_idx
  ON organization_authority_evidence (fresh_until, grace_until, grant_id)
  WHERE status <> 'invalid';

ALTER TABLE organization_corporation_sources
  ADD COLUMN source_user_id uuid,
  ADD COLUMN source_subject_lifecycle_id uuid,
  ADD COLUMN authorization_generation integer,
  ADD COLUMN role_evidence_revision text,
  ADD COLUMN observed_corporation_id bigint,
  ADD COLUMN observed_alliance_id bigint,
  ADD COLUMN required_scope text,
  ADD COLUMN director_role_present boolean,
  ADD COLUMN observed_at timestamp with time zone,
  ADD COLUMN fresh_until timestamp with time zone,
  ADD COLUMN grace_until timestamp with time zone,
  ADD COLUMN status text,
  ADD COLUMN failure_class text,
  ADD COLUMN invalidated_at timestamp with time zone,
  ADD COLUMN invalidation_outcome text;

UPDATE organization_corporation_sources source
SET source_user_id = COALESCE(
      (
        SELECT character.user_id
        FROM characters character
        WHERE character.character_id = source.evidence_character_id
      ),
      source.registered_by_user_id
    ),
    source_subject_lifecycle_id = COALESCE(
      (
        SELECT lifecycle.subject_lifecycle_id
        FROM platform_subject_lifecycles lifecycle
        WHERE lifecycle.character_id = source.evidence_character_id
          AND is_character_subject_kind(lifecycle.subject_kind)
      ),
      gen_random_uuid()
    ),
    authorization_generation = COALESCE(
      (
        SELECT token.token_version
        FROM eve_tokens token
        WHERE token.character_id = source.evidence_character_id
      ),
      0
    ),
    role_evidence_revision = 'legacy-invalidated:' || source.source_id::text,
    observed_corporation_id = source.corporation_id,
    observed_alliance_id = (
      SELECT character.alliance_id
      FROM characters character
      WHERE character.character_id = source.evidence_character_id
    ),
    required_scope = 'esi-corporations.read_corporation_membership.v1',
    director_role_present = false,
    observed_at = source.registered_at,
    fresh_until = source.registered_at + interval '1 microsecond',
    status = 'invalid',
    failure_class = 'strict:authorization-missing',
    invalidated_at = clock_timestamp(),
    invalidation_outcome = 'authorization-missing',
    updated_at = clock_timestamp();

ALTER TABLE organization_corporation_sources
  ALTER COLUMN source_user_id SET NOT NULL,
  ALTER COLUMN source_subject_lifecycle_id SET NOT NULL,
  ALTER COLUMN authorization_generation SET NOT NULL,
  ALTER COLUMN role_evidence_revision SET NOT NULL,
  ALTER COLUMN observed_corporation_id SET NOT NULL,
  ALTER COLUMN required_scope SET NOT NULL,
  ALTER COLUMN director_role_present SET NOT NULL,
  ALTER COLUMN observed_at SET NOT NULL,
  ALTER COLUMN fresh_until SET NOT NULL,
  ALTER COLUMN status SET NOT NULL,
  ADD CONSTRAINT organization_corporation_sources_source_user_fkey FOREIGN KEY (source_user_id)
    REFERENCES users (id) ON DELETE RESTRICT,
  ADD CONSTRAINT organization_corporation_sources_authorization_generation_check CHECK (
    authorization_generation >= 0
  ),
  ADD CONSTRAINT organization_corporation_sources_observed_corporation_check CHECK (
    (character_id IS NULL OR character_id = evidence_character_id)
    AND observed_corporation_id = corporation_id
  ),
  ADD CONSTRAINT organization_corporation_sources_required_scope_check CHECK (
    length(trim(required_scope)) > 0
  ),
  ADD CONSTRAINT organization_corporation_sources_role_evidence_revision_check CHECK (
    length(trim(role_evidence_revision)) > 0
  ),
  ADD CONSTRAINT organization_corporation_sources_failure_class_check CHECK (
    failure_class IS NULL OR failure_class ~ '^(strict|transient):[a-z][a-z0-9-]{0,99}$'
  ),
  ADD CONSTRAINT organization_corporation_sources_invalidation_outcome_check CHECK (
    invalidation_outcome IS NULL OR invalidation_outcome IN (
      'affiliation-changed', 'authorization-generation-changed', 'authorization-missing',
      'authorization-rejected', 'authorization-revoked', 'blocked', 'detached', 'expired',
      'lifecycle-replaced', 'missing-scope', 'not-director', 'organization-replaced',
      'owner-mismatch', 'policy-disabled', 'source-replaced', 'transferred', 'wrong-alliance',
      'wrong-corporation'
    )
  ),
  ADD CONSTRAINT organization_corporation_sources_status_check CHECK (
    status IN ('fresh', 'degraded', 'invalid')
  ),
  ADD CONSTRAINT organization_corporation_sources_deadline_check CHECK (
    fresh_until > observed_at
    AND (grace_until IS NULL OR grace_until >= fresh_until)
  ),
  ADD CONSTRAINT organization_corporation_sources_state_check CHECK (
    (
      status = 'fresh'
      AND director_role_present
      AND failure_class IS NULL
      AND grace_until IS NULL
      AND invalidated_at IS NULL
      AND invalidation_outcome IS NULL
    ) OR (
      status = 'degraded'
      AND director_role_present
      AND failure_class IS NOT NULL
      AND grace_until IS NOT NULL
      AND invalidated_at IS NULL
      AND invalidation_outcome IS NULL
    ) OR (
      status = 'invalid'
      AND failure_class IS NOT NULL
      AND grace_until IS NULL
      AND invalidated_at IS NOT NULL
      AND invalidation_outcome IS NOT NULL
    )
  );

CREATE INDEX organization_corporation_sources_source_binding_idx
  ON organization_corporation_sources (
    source_subject_lifecycle_id, authorization_generation, role_evidence_revision
  );

CREATE TABLE organization_derived_authority_sources (
  source_id uuid DEFAULT gen_random_uuid() PRIMARY KEY NOT NULL,
  deployment_id smallint DEFAULT 1 NOT NULL,
  organization_version bigint NOT NULL,
  user_id uuid NOT NULL,
  role text DEFAULT 'director' NOT NULL,
  character_id bigint NOT NULL,
  source_subject_lifecycle_id uuid NOT NULL,
  authority_corporation_id bigint NOT NULL,
  observed_corporation_id bigint NOT NULL,
  observed_alliance_id bigint,
  authorization_generation integer NOT NULL,
  required_scope text NOT NULL,
  role_evidence_revision text NOT NULL,
  director_role_present boolean NOT NULL,
  observed_at timestamp with time zone NOT NULL,
  fresh_until timestamp with time zone NOT NULL,
  grace_until timestamp with time zone,
  status text NOT NULL,
  failure_class text,
  invalidated_at timestamp with time zone,
  invalidation_outcome text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT organization_derived_authority_sources_epoch_fkey FOREIGN KEY (
    deployment_id, organization_version
  ) REFERENCES organization_epochs (deployment_id, organization_version) ON DELETE RESTRICT,
  CONSTRAINT organization_derived_authority_sources_user_fkey FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT organization_derived_authority_sources_role_check CHECK (role = 'director'),
  CONSTRAINT organization_derived_authority_sources_character_check CHECK (
    character_id > 0 AND authority_corporation_id > 0
    AND observed_corporation_id = authority_corporation_id
  ),
  CONSTRAINT organization_derived_authority_sources_authorization_generation_check CHECK (
    authorization_generation >= 0
  ),
  CONSTRAINT organization_derived_authority_sources_required_scope_check CHECK (
    length(trim(required_scope)) > 0
  ),
  CONSTRAINT organization_derived_authority_sources_role_evidence_revision_check CHECK (
    length(trim(role_evidence_revision)) > 0
  ),
  CONSTRAINT organization_derived_authority_sources_failure_class_check CHECK (
    failure_class IS NULL OR failure_class ~ '^(strict|transient):[a-z][a-z0-9-]{0,99}$'
  ),
  CONSTRAINT organization_derived_authority_sources_invalidation_outcome_check CHECK (
    invalidation_outcome IS NULL OR invalidation_outcome IN (
      'affiliation-changed', 'authorization-generation-changed', 'authorization-missing',
      'authorization-rejected', 'authorization-revoked', 'blocked', 'detached', 'expired',
      'lifecycle-replaced', 'missing-scope', 'not-director', 'organization-replaced',
      'owner-mismatch', 'policy-disabled', 'source-replaced', 'transferred', 'wrong-alliance',
      'wrong-corporation'
    )
  ),
  CONSTRAINT organization_derived_authority_sources_status_check CHECK (
    status IN ('fresh', 'degraded', 'invalid')
  ),
  CONSTRAINT organization_derived_authority_sources_deadline_check CHECK (
    fresh_until > observed_at
    AND (grace_until IS NULL OR grace_until >= fresh_until)
  ),
  CONSTRAINT organization_derived_authority_sources_state_check CHECK (
    (
      status = 'fresh'
      AND director_role_present
      AND failure_class IS NULL
      AND grace_until IS NULL
      AND invalidated_at IS NULL
      AND invalidation_outcome IS NULL
    ) OR (
      status = 'degraded'
      AND director_role_present
      AND failure_class IS NOT NULL
      AND grace_until IS NOT NULL
      AND invalidated_at IS NULL
      AND invalidation_outcome IS NULL
    ) OR (
      status = 'invalid'
      AND failure_class IS NOT NULL
      AND grace_until IS NULL
      AND invalidated_at IS NOT NULL
      AND invalidation_outcome IS NOT NULL
    )
  )
);

ALTER TABLE organization_derived_authority_sources
  ADD CONSTRAINT organization_derived_authority_sources_lifecycle_key UNIQUE (
    deployment_id, organization_version, user_id, role, source_subject_lifecycle_id,
    role_evidence_revision
  );

CREATE UNIQUE INDEX organization_derived_authority_sources_current_idx
  ON organization_derived_authority_sources (
    deployment_id, organization_version, user_id, role, source_subject_lifecycle_id
  )
  WHERE invalidated_at IS NULL;

CREATE INDEX organization_derived_authority_sources_effective_idx
  ON organization_derived_authority_sources (
    deployment_id, organization_version, user_id, role, status, fresh_until
  )
  WHERE invalidated_at IS NULL;

CREATE INDEX organization_derived_authority_sources_refresh_idx
  ON organization_derived_authority_sources (fresh_until, grace_until, source_id)
  WHERE invalidated_at IS NULL;

CREATE FUNCTION enforce_authority_source_character_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  bound_character_id bigint;
  bound_user_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'organization_corporation_sources' THEN
    bound_character_id := NEW.evidence_character_id;
    bound_user_id := NEW.source_user_id;
  ELSE
    bound_character_id := NEW.character_id;
    bound_user_id := NEW.user_id;
  END IF;

  PERFORM 1
  FROM platform_subject_lifecycles lifecycle
  JOIN characters character ON character.character_id = lifecycle.character_id
  WHERE lifecycle.subject_lifecycle_id = NEW.source_subject_lifecycle_id
    AND is_character_subject_kind(lifecycle.subject_kind)
    AND lifecycle.character_id = bound_character_id
    AND character.user_id = bound_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Authority source lifecycle does not match its character and account'
      USING ERRCODE = '23514',
        CONSTRAINT = 'authority_source_character_lifecycle_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER organization_authority_evidence_character_lifecycle_trigger
  BEFORE INSERT OR UPDATE OF character_id, user_id, source_subject_lifecycle_id
  ON organization_authority_evidence
  FOR EACH ROW EXECUTE FUNCTION enforce_authority_source_character_lifecycle();

CREATE TRIGGER organization_derived_authority_character_lifecycle_trigger
  BEFORE INSERT OR UPDATE OF character_id, user_id, source_subject_lifecycle_id
  ON organization_derived_authority_sources
  FOR EACH ROW EXECUTE FUNCTION enforce_authority_source_character_lifecycle();

CREATE TRIGGER organization_corporation_source_character_lifecycle_trigger
  BEFORE INSERT OR UPDATE OF evidence_character_id, source_user_id, source_subject_lifecycle_id
  ON organization_corporation_sources
  FOR EACH ROW EXECUTE FUNCTION enforce_authority_source_character_lifecycle();

ALTER TABLE organization_audit_events
  DROP CONSTRAINT organization_audit_events_type_check,
  DROP CONSTRAINT organization_audit_events_subject_type_check,
  ADD CONSTRAINT organization_audit_events_type_check CHECK (event_type IN (
    'organization.changed',
    'registration-policy.changed',
    'role.granted',
    'role.revoked',
    'exception.approved',
    'exception.expired',
    'exception.revoked',
    'compliance.transitioned',
    'entitlement.granted',
    'entitlement.revoked',
    'corporation-source.registered',
    'corporation-source.replaced',
    'corporation-source.revoked',
    'authority-source.observed',
    'authority-source.invalidated',
    'group.assigned',
    'group.revoked',
    'member.blocked',
    'member.unblocked',
    'permission-bundle.created',
    'permission-bundle.updated',
    'sensitive-access.decided'
  )),
  ADD CONSTRAINT organization_audit_events_subject_type_check CHECK (subject_type IN (
    'deployment',
    'user',
    'character',
    'role_grant',
    'authority_source',
    'exception',
    'compliance',
    'corporation_source',
    'managed_corporation',
    'group',
    'permission_bundle',
    'external_service'
  ));
