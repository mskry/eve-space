CREATE SEQUENCE character_corporation_role_observation_sequence AS bigint START WITH 1 NO CYCLE;

ALTER TABLE characters
  ADD COLUMN affiliation_period_revision uuid DEFAULT gen_random_uuid() NOT NULL;

CREATE FUNCTION is_canonical_corporation_role_set(role_set text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT cardinality(role_set) <= 64
    AND array_position(role_set, NULL) IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM unnest(role_set) AS role_name
      WHERE role_name !~ '^[A-Z][A-Za-z0-9_]{0,63}$'
    )
    AND role_set = ARRAY(
      SELECT DISTINCT role_name COLLATE "C" FROM unnest(role_set) AS role_name ORDER BY 1
    )
$$;

CREATE TABLE character_corporation_role_observations (
  observation_id uuid DEFAULT gen_random_uuid() PRIMARY KEY NOT NULL,
  deployment_id smallint DEFAULT 1 NOT NULL,
  organization_version bigint NOT NULL,
  user_id uuid NOT NULL,
  character_id bigint NOT NULL,
  source_subject_lifecycle_id uuid NOT NULL,
  affiliation_period_revision uuid NOT NULL,
  authority_corporation_id bigint NOT NULL,
  observed_alliance_id bigint,
  authorization_generation integer NOT NULL,
  required_scope text NOT NULL,
  role_revision uuid,
  status text NOT NULL,
  validated_at timestamp with time zone,
  esi_fresh_until timestamp with time zone,
  fresh_until timestamp with time zone,
  degraded_until timestamp with time zone,
  next_refresh_at timestamp with time zone,
  last_checked_at timestamp with time zone NOT NULL,
  last_applied_observation_sequence bigint NOT NULL,
  failure_class text,
  invalidated_at timestamp with time zone,
  invalidation_outcome text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT character_corporation_role_observations_epoch_fkey FOREIGN KEY (
    deployment_id, organization_version
  ) REFERENCES organization_epochs (deployment_id, organization_version) ON DELETE RESTRICT,
  CONSTRAINT character_corporation_role_observations_user_fkey FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT character_corporation_role_observations_identity_check CHECK (
    character_id > 0 AND authority_corporation_id > 0
  ),
  CONSTRAINT character_corporation_role_observations_authorization_generation_check CHECK (
    authorization_generation >= 0
  ),
  CONSTRAINT character_corporation_role_observations_required_scope_check CHECK (
    length(trim(required_scope)) > 0
  ),
  CONSTRAINT character_corporation_role_observations_sequence_check CHECK (
    last_applied_observation_sequence > 0
  ),
  CONSTRAINT character_corporation_role_observations_status_check CHECK (
    status IN ('pending', 'fresh', 'degraded', 'invalid')
  ),
  CONSTRAINT character_corporation_role_observations_failure_class_check CHECK (
    failure_class IS NULL OR failure_class ~ '^(strict|transient):[a-z][a-z0-9-]{0,99}$'
  ),
  CONSTRAINT character_corporation_role_observations_invalidation_outcome_check CHECK (
    invalidation_outcome IS NULL OR invalidation_outcome IN (
      'affiliation-changed', 'authorization-generation-changed', 'authorization-missing',
      'authorization-rejected', 'authorization-revoked', 'detached', 'expired',
      'lifecycle-replaced', 'missing-scope', 'organization-replaced', 'owner-mismatch',
      'transferred'
    )
  ),
  CONSTRAINT character_corporation_role_observations_deadline_check CHECK (
    (validated_at IS NULL) = (esi_fresh_until IS NULL)
    AND (validated_at IS NULL) = (fresh_until IS NULL)
    AND (fresh_until IS NULL OR (fresh_until > validated_at AND fresh_until <= esi_fresh_until))
    AND (degraded_until IS NULL OR degraded_until >= fresh_until)
  ),
  CONSTRAINT character_corporation_role_observations_state_check CHECK (
    (
      status = 'pending'
      AND role_revision IS NULL
      AND validated_at IS NULL
      AND degraded_until IS NULL
      AND next_refresh_at IS NOT NULL
      AND failure_class LIKE 'transient:%'
      AND invalidated_at IS NULL
      AND invalidation_outcome IS NULL
    ) OR (
      status = 'fresh'
      AND role_revision IS NOT NULL
      AND validated_at IS NOT NULL
      AND degraded_until IS NULL
      AND next_refresh_at IS NOT NULL
      AND (failure_class IS NULL OR failure_class LIKE 'transient:%')
      AND invalidated_at IS NULL
      AND invalidation_outcome IS NULL
    ) OR (
      status = 'degraded'
      AND role_revision IS NOT NULL
      AND validated_at IS NOT NULL
      AND degraded_until IS NOT NULL
      AND next_refresh_at IS NOT NULL
      AND failure_class LIKE 'transient:%'
      AND invalidated_at IS NULL
      AND invalidation_outcome IS NULL
    ) OR (
      status = 'invalid'
      AND role_revision IS NOT NULL
      AND degraded_until IS NULL
      AND next_refresh_at IS NULL
      AND failure_class LIKE 'strict:%'
      AND invalidated_at IS NOT NULL
      AND invalidation_outcome IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX character_corporation_role_observations_binding_key
  ON character_corporation_role_observations (
    deployment_id, organization_version, source_subject_lifecycle_id,
    affiliation_period_revision, authority_corporation_id, authorization_generation
  );

CREATE UNIQUE INDEX character_corporation_role_observations_current_key
  ON character_corporation_role_observations (deployment_id, organization_version, character_id)
  WHERE status <> 'invalid';

CREATE INDEX character_corporation_role_observations_due_idx
  ON character_corporation_role_observations (next_refresh_at, character_id)
  WHERE status <> 'invalid';

CREATE INDEX character_corporation_role_observations_character_idx
  ON character_corporation_role_observations (character_id, organization_version);

CREATE TABLE character_corporation_role_contents (
  observation_id uuid PRIMARY KEY NOT NULL,
  roles text[] NOT NULL,
  roles_at_base text[] NOT NULL,
  roles_at_hq text[] NOT NULL,
  roles_at_other text[] NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT character_corporation_role_contents_observation_fkey FOREIGN KEY (observation_id)
    REFERENCES character_corporation_role_observations (observation_id) ON DELETE CASCADE,
  CONSTRAINT character_corporation_role_contents_canonical_check CHECK (
    is_canonical_corporation_role_set(roles)
    AND is_canonical_corporation_role_set(roles_at_base)
    AND is_canonical_corporation_role_set(roles_at_hq)
    AND is_canonical_corporation_role_set(roles_at_other)
  )
);

CREATE FUNCTION assert_corporation_role_content_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_observation_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_observation_id := OLD.observation_id;
  ELSE
    target_observation_id := NEW.observation_id;
  END IF;

  PERFORM 1
  FROM character_corporation_role_observations observation
  WHERE observation.observation_id = target_observation_id
    AND (observation.status IN ('fresh', 'degraded')) <> EXISTS (
      SELECT 1
      FROM character_corporation_role_contents content
      WHERE content.observation_id = observation.observation_id
    );

  IF FOUND THEN
    RAISE EXCEPTION 'Corporation-role content must exist exactly for current observations'
      USING ERRCODE = '23514',
        CONSTRAINT = 'character_corporation_role_content_state_check';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER character_corporation_role_observation_content_state_trigger
  AFTER INSERT OR UPDATE OR DELETE ON character_corporation_role_observations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_corporation_role_content_state();

CREATE CONSTRAINT TRIGGER character_corporation_role_content_state_trigger
  AFTER INSERT OR UPDATE OR DELETE ON character_corporation_role_contents
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_corporation_role_content_state();

CREATE TRIGGER character_corporation_role_observation_lifecycle_trigger
  BEFORE INSERT OR UPDATE OF character_id, user_id, source_subject_lifecycle_id
  ON character_corporation_role_observations
  FOR EACH ROW EXECUTE FUNCTION enforce_authority_source_character_lifecycle();

CREATE FUNCTION rotate_character_affiliation_period()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.corporation_id IS DISTINCT FROM OLD.corporation_id
    OR NEW.alliance_id IS DISTINCT FROM OLD.alliance_id THEN
    NEW.affiliation_period_revision := gen_random_uuid();
  ELSE
    NEW.affiliation_period_revision := OLD.affiliation_period_revision;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER characters_affiliation_period_trigger
  BEFORE UPDATE ON characters
  FOR EACH ROW EXECUTE FUNCTION rotate_character_affiliation_period();

CREATE FUNCTION invalidate_replaced_affiliation_role_observations()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.affiliation_period_revision = OLD.affiliation_period_revision THEN
    RETURN NULL;
  END IF;

  DELETE FROM character_corporation_role_contents content
  USING character_corporation_role_observations observation
  WHERE content.observation_id = observation.observation_id
    AND observation.character_id = OLD.character_id
    AND observation.affiliation_period_revision = OLD.affiliation_period_revision;

  UPDATE character_corporation_role_observations
  SET status = 'invalid',
      role_revision = COALESCE(role_revision, gen_random_uuid()),
      degraded_until = NULL,
      next_refresh_at = NULL,
      failure_class = 'strict:affiliation-changed',
      invalidated_at = clock_timestamp(),
      invalidation_outcome = 'affiliation-changed',
      updated_at = clock_timestamp()
  WHERE character_id = OLD.character_id
    AND affiliation_period_revision = OLD.affiliation_period_revision
    AND status <> 'invalid';
  RETURN NULL;
END;
$$;

CREATE TRIGGER characters_affiliation_period_role_observation_trigger
  AFTER UPDATE OF corporation_id, alliance_id ON characters
  FOR EACH ROW EXECUTE FUNCTION invalidate_replaced_affiliation_role_observations();

ALTER TABLE organization_authority_evidence
  ADD COLUMN affiliation_period_revision uuid,
  ADD COLUMN legacy_role_continuity_until timestamp with time zone;

ALTER TABLE organization_derived_authority_sources
  ADD COLUMN affiliation_period_revision uuid,
  ADD COLUMN legacy_role_continuity_until timestamp with time zone;

ALTER TABLE organization_corporation_sources
  ADD COLUMN affiliation_period_revision uuid,
  ADD COLUMN legacy_role_continuity_until timestamp with time zone;

UPDATE organization_authority_evidence evidence
SET affiliation_period_revision = character.affiliation_period_revision
FROM characters character
WHERE character.character_id = evidence.character_id
  AND character.corporation_id = evidence.observed_corporation_id
  AND character.alliance_id IS NOT DISTINCT FROM evidence.observed_alliance_id;

UPDATE organization_authority_evidence
SET legacy_role_continuity_until = fresh_until
WHERE status = 'fresh'
  AND director_role_present
  AND invalidated_at IS NULL
  AND affiliation_period_revision IS NOT NULL
  AND fresh_until > clock_timestamp();

UPDATE organization_derived_authority_sources source
SET affiliation_period_revision = character.affiliation_period_revision
FROM characters character
WHERE character.character_id = source.character_id
  AND character.corporation_id = source.observed_corporation_id
  AND character.alliance_id IS NOT DISTINCT FROM source.observed_alliance_id;

UPDATE organization_derived_authority_sources
SET legacy_role_continuity_until = fresh_until
WHERE status = 'fresh'
  AND director_role_present
  AND invalidated_at IS NULL
  AND affiliation_period_revision IS NOT NULL
  AND fresh_until > clock_timestamp();

UPDATE organization_corporation_sources source
SET affiliation_period_revision = character.affiliation_period_revision
FROM characters character
WHERE character.character_id = source.evidence_character_id
  AND character.corporation_id = source.observed_corporation_id
  AND character.alliance_id IS NOT DISTINCT FROM source.observed_alliance_id;

UPDATE organization_corporation_sources
SET legacy_role_continuity_until = fresh_until
WHERE status = 'fresh'
  AND director_role_present
  AND invalidated_at IS NULL
  AND revoked_at IS NULL
  AND affiliation_period_revision IS NOT NULL
  AND fresh_until > clock_timestamp();

ALTER TABLE organization_authority_evidence
  ADD CONSTRAINT organization_authority_evidence_legacy_role_continuity_check CHECK (
    legacy_role_continuity_until IS NULL OR affiliation_period_revision IS NOT NULL
  );

ALTER TABLE organization_derived_authority_sources
  ADD CONSTRAINT organization_derived_authority_sources_legacy_role_continuity_check CHECK (
    legacy_role_continuity_until IS NULL OR affiliation_period_revision IS NOT NULL
  );

ALTER TABLE organization_corporation_sources
  ADD CONSTRAINT organization_corporation_sources_legacy_role_continuity_check CHECK (
    legacy_role_continuity_until IS NULL OR affiliation_period_revision IS NOT NULL
  );

CREATE FUNCTION guard_legacy_role_continuity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.legacy_role_continuity_until IS NOT NULL THEN
      RAISE EXCEPTION 'Legacy corporation-role continuity cannot be created'
        USING ERRCODE = '23514', CONSTRAINT = 'legacy_role_continuity_check';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.legacy_role_continuity_until IS NOT NULL AND (
    OLD.legacy_role_continuity_until IS NULL
    OR NEW.legacy_role_continuity_until > OLD.legacy_role_continuity_until
  ) THEN
    RAISE EXCEPTION 'Legacy corporation-role continuity cannot be extended'
      USING ERRCODE = '23514', CONSTRAINT = 'legacy_role_continuity_check';
  END IF;

  IF NEW.source_subject_lifecycle_id IS DISTINCT FROM OLD.source_subject_lifecycle_id
    OR NEW.authorization_generation IS DISTINCT FROM OLD.authorization_generation
    OR NEW.affiliation_period_revision IS DISTINCT FROM OLD.affiliation_period_revision
    OR NEW.role_evidence_revision IS DISTINCT FROM OLD.role_evidence_revision
    OR NEW.organization_version IS DISTINCT FROM OLD.organization_version
    OR NEW.observed_corporation_id IS DISTINCT FROM OLD.observed_corporation_id
    OR NEW.observed_alliance_id IS DISTINCT FROM OLD.observed_alliance_id
    OR NEW.status <> 'fresh'
    OR NOT NEW.director_role_present
    OR NEW.invalidated_at IS NOT NULL THEN
    NEW.legacy_role_continuity_until := NULL;
  END IF;
  IF TG_TABLE_NAME = 'organization_corporation_sources' THEN
    IF NEW.revoked_at IS NOT NULL THEN
      NEW.legacy_role_continuity_until := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER organization_authority_evidence_legacy_role_continuity_trigger
  BEFORE INSERT OR UPDATE ON organization_authority_evidence
  FOR EACH ROW EXECUTE FUNCTION guard_legacy_role_continuity();

CREATE TRIGGER organization_derived_authority_legacy_role_continuity_trigger
  BEFORE INSERT OR UPDATE ON organization_derived_authority_sources
  FOR EACH ROW EXECUTE FUNCTION guard_legacy_role_continuity();

CREATE TRIGGER organization_corporation_source_legacy_role_continuity_trigger
  BEFORE INSERT OR UPDATE ON organization_corporation_sources
  FOR EACH ROW EXECUTE FUNCTION guard_legacy_role_continuity();
