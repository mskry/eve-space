ALTER TABLE organization_groups DROP CONSTRAINT organization_groups_management_check;
ALTER TABLE organization_groups ADD CONSTRAINT organization_groups_management_check CHECK (
  (management_mode = 'manual' AND compliance_source IS NULL)
  OR (management_mode = 'compliance' AND compliance_source = 'core.registration')
  OR (management_mode = 'rule' AND compliance_source IS NULL AND restricted)
);

CREATE TABLE organization_group_rules (
  group_id uuid PRIMARY KEY NOT NULL,
  deployment_id smallint DEFAULT 1 NOT NULL,
  organization_version bigint NOT NULL,
  revision bigint DEFAULT 1 NOT NULL,
  condition_kind text NOT NULL,
  predicate_key text,
  enabled boolean DEFAULT false NOT NULL,
  updated_by_user_id uuid NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT organization_group_rules_version_key UNIQUE (group_id, deployment_id, organization_version),
  CONSTRAINT organization_group_rules_group_fkey FOREIGN KEY (
    group_id, deployment_id, organization_version
  ) REFERENCES organization_groups (group_id, deployment_id, organization_version) ON DELETE RESTRICT,
  CONSTRAINT organization_group_rules_actor_fkey FOREIGN KEY (updated_by_user_id)
    REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT organization_group_rules_revision_check CHECK (revision > 0),
  CONSTRAINT organization_group_rules_condition_check CHECK (
    (condition_kind IN ('registration-compliant', 'director-audience') AND predicate_key IS NULL)
    OR (condition_kind = 'corporation-role' AND predicate_key IN (
      'director', 'accountant', 'factory-manager'
    ))
  )
);

CREATE TABLE organization_group_rule_revisions (
  group_id uuid NOT NULL,
  deployment_id smallint DEFAULT 1 NOT NULL,
  organization_version bigint NOT NULL,
  revision bigint NOT NULL,
  condition_kind text NOT NULL,
  predicate_key text,
  enabled boolean NOT NULL,
  bundle_ids uuid[] NOT NULL,
  changed_by_user_id uuid NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT organization_group_rule_revisions_pkey PRIMARY KEY (
    group_id, deployment_id, organization_version, revision
  ),
  CONSTRAINT organization_group_rule_revisions_rule_fkey FOREIGN KEY (
    group_id, deployment_id, organization_version
  ) REFERENCES organization_group_rules (group_id, deployment_id, organization_version)
    ON DELETE RESTRICT,
  CONSTRAINT organization_group_rule_revisions_actor_fkey FOREIGN KEY (changed_by_user_id)
    REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT organization_group_rule_revisions_revision_check CHECK (revision > 0),
  CONSTRAINT organization_group_rule_revisions_bundles_check CHECK (
    cardinality(bundle_ids) BETWEEN 1 AND 50 AND array_position(bundle_ids, NULL) IS NULL
  ),
  CONSTRAINT organization_group_rule_revisions_condition_check CHECK (
    (condition_kind IN ('registration-compliant', 'director-audience') AND predicate_key IS NULL)
    OR (condition_kind = 'corporation-role' AND predicate_key IN (
      'director', 'accountant', 'factory-manager'
    ))
  )
);

CREATE FUNCTION enforce_organization_group_rule_management() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM organization_groups
    WHERE group_id = NEW.group_id AND deployment_id = NEW.deployment_id
      AND organization_version = NEW.organization_version
      AND management_mode = 'rule' AND restricted
  ) OR NOT EXISTS (
    SELECT 1 FROM deployment_settings
    WHERE id = NEW.deployment_id AND organization_version = NEW.organization_version
  ) THEN
    RAISE EXCEPTION 'rule requires a current restricted rule-managed group';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER organization_group_rules_management_guard
  BEFORE INSERT OR UPDATE OF group_id, deployment_id, organization_version
  ON organization_group_rules FOR EACH ROW
  EXECUTE FUNCTION enforce_organization_group_rule_management();

CREATE FUNCTION require_organization_group_rule() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.management_mode = 'rule' AND NOT EXISTS (
    SELECT 1 FROM organization_group_rules
    WHERE group_id = NEW.group_id AND deployment_id = NEW.deployment_id
      AND organization_version = NEW.organization_version
  ) THEN
    RAISE EXCEPTION 'rule-managed group requires a current rule';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER organization_groups_rule_required
  AFTER INSERT OR UPDATE OF management_mode ON organization_groups
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION require_organization_group_rule();

CREATE FUNCTION preserve_organization_group_management() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.management_mode IS DISTINCT FROM NEW.management_mode
    OR OLD.compliance_source IS DISTINCT FROM NEW.compliance_source
    OR (OLD.management_mode = 'rule' AND NOT NEW.restricted) THEN
    RAISE EXCEPTION 'group management mode is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER organization_groups_management_immutable
  BEFORE UPDATE OF management_mode, compliance_source, restricted
  ON organization_groups FOR EACH ROW
  EXECUTE FUNCTION preserve_organization_group_management();

CREATE FUNCTION require_organization_group_rule_revision() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM organization_group_rule_revisions
    WHERE group_id = NEW.group_id AND deployment_id = NEW.deployment_id
      AND organization_version = NEW.organization_version AND revision = NEW.revision
      AND condition_kind = NEW.condition_kind AND predicate_key IS NOT DISTINCT FROM NEW.predicate_key
      AND enabled = NEW.enabled
  ) THEN
    RAISE EXCEPTION 'current rule must match an immutable revision';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER organization_group_rules_revision_required
  AFTER INSERT OR UPDATE ON organization_group_rules
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION require_organization_group_rule_revision();

CREATE FUNCTION enforce_organization_group_rule_history() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'organization rule revisions are append-only';
END;
$$;

CREATE TRIGGER organization_group_rule_revisions_append_only
  BEFORE UPDATE OR DELETE ON organization_group_rule_revisions
  FOR EACH ROW EXECUTE FUNCTION enforce_organization_group_rule_history();

ALTER TABLE organization_group_assignments
  ADD COLUMN rule_revision bigint;

ALTER TABLE organization_group_assignments
  DROP CONSTRAINT organization_group_assignments_source_check,
  DROP CONSTRAINT organization_group_assignments_assignment_actor_check,
  ADD CONSTRAINT organization_group_assignments_source_check CHECK (
    assignment_source IN ('manual', 'compliance', 'rule')
  ),
  ADD CONSTRAINT organization_group_assignments_assignment_actor_check CHECK (
    (assignment_source = 'manual' AND assigned_actor_type = 'user'
      AND assigned_by_user_id IS NOT NULL AND rule_revision IS NULL)
    OR (assignment_source = 'compliance' AND assigned_actor_type = 'system'
      AND assigned_by_user_id IS NULL AND expires_at IS NULL AND rule_revision IS NULL)
    OR (assignment_source = 'rule' AND assigned_actor_type = 'system'
      AND assigned_by_user_id IS NULL AND compliance_source IS NULL
      AND expires_at IS NOT NULL AND rule_revision > 0)
  ),
  ADD CONSTRAINT organization_group_assignments_rule_revision_fkey FOREIGN KEY (
    group_id, deployment_id, organization_version, rule_revision
  ) REFERENCES organization_group_rule_revisions (
    group_id, deployment_id, organization_version, revision
  ) ON DELETE RESTRICT;

CREATE TABLE organization_group_rule_attestations (
  assignment_id uuid NOT NULL,
  source_kind text NOT NULL,
  source_id uuid NOT NULL,
  subject_lifecycle_id uuid,
  affiliation_period_revision uuid,
  authorization_generation integer,
  authority_corporation_id bigint,
  role_revision uuid,
  valid_until timestamptz NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT organization_group_rule_attestations_pkey PRIMARY KEY (
    assignment_id, source_kind, source_id
  ),
  CONSTRAINT organization_group_rule_attestations_assignment_fkey FOREIGN KEY (assignment_id)
    REFERENCES organization_group_assignments (assignment_id) ON DELETE CASCADE,
  CONSTRAINT organization_group_rule_attestations_kind_check CHECK (
    source_kind IN ('registration', 'explicit-director', 'derived-director', 'corporation-role')
  ),
  CONSTRAINT organization_group_rule_attestations_binding_check CHECK (
    (source_kind IN ('registration', 'explicit-director')
      AND subject_lifecycle_id IS NULL AND affiliation_period_revision IS NULL
      AND authorization_generation IS NULL AND authority_corporation_id IS NULL
      AND role_revision IS NULL)
    OR (source_kind IN ('derived-director', 'corporation-role')
      AND subject_lifecycle_id IS NOT NULL AND affiliation_period_revision IS NOT NULL
      AND authorization_generation >= 0 AND authority_corporation_id > 0
      AND role_revision IS NOT NULL)
  )
);

CREATE INDEX organization_group_rule_attestations_source_idx
  ON organization_group_rule_attestations (source_kind, source_id, valid_until);

CREATE FUNCTION require_rule_assignment_attestation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  assignment_source text;
BEGIN
  SELECT assignment.assignment_source INTO assignment_source
  FROM organization_group_assignments assignment
  WHERE assignment.assignment_id = NEW.assignment_id;
  IF assignment_source IS DISTINCT FROM 'rule' THEN
    RAISE EXCEPTION 'rule attestation requires a rule-managed assignment';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER organization_group_rule_attestations_management_guard
  BEFORE INSERT OR UPDATE OF assignment_id ON organization_group_rule_attestations
  FOR EACH ROW EXECUTE FUNCTION require_rule_assignment_attestation();

CREATE TABLE organization_group_rule_reconciliation (
  group_id uuid PRIMARY KEY NOT NULL,
  deployment_id smallint DEFAULT 1 NOT NULL,
  organization_version bigint NOT NULL,
  revision bigint NOT NULL,
  cursor_user_id uuid,
  completed_at timestamptz,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT organization_group_rule_reconciliation_revision_fkey FOREIGN KEY (
    group_id, deployment_id, organization_version, revision
  ) REFERENCES organization_group_rule_revisions (
    group_id, deployment_id, organization_version, revision
  ) ON DELETE RESTRICT,
  CONSTRAINT organization_group_rule_reconciliation_revision_check CHECK (revision > 0)
);

REVOKE ALL ON FUNCTION enforce_organization_group_rule_management() FROM PUBLIC;
REVOKE ALL ON FUNCTION require_organization_group_rule() FROM PUBLIC;
REVOKE ALL ON FUNCTION preserve_organization_group_management() FROM PUBLIC;
REVOKE ALL ON FUNCTION require_organization_group_rule_revision() FROM PUBLIC;
REVOKE ALL ON FUNCTION enforce_organization_group_rule_history() FROM PUBLIC;
REVOKE ALL ON FUNCTION require_rule_assignment_attestation() FROM PUBLIC;
