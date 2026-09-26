ALTER TABLE organization_audit_events
  ADD COLUMN rule_revision bigint,
  ADD COLUMN resulting_permissions text[];

ALTER TABLE organization_audit_events
  DROP CONSTRAINT organization_audit_events_type_check,
  DROP CONSTRAINT organization_audit_events_context_check;

ALTER TABLE organization_audit_events
  ADD CONSTRAINT organization_audit_events_type_check CHECK (event_type IN (
    'organization.changed', 'registration-policy.changed', 'role.granted', 'role.revoked',
    'exception.approved', 'exception.expired', 'exception.revoked',
    'compliance.transitioned', 'entitlement.granted', 'entitlement.revoked',
    'corporation-source.registered', 'corporation-source.replaced',
    'corporation-source.revoked', 'authority-source.observed',
    'authority-source.invalidated', 'group.assigned', 'group.revoked',
    'group.refreshed', 'group-rule.created', 'group-rule.updated',
    'group-rule.disabled', 'member.blocked', 'member.unblocked',
    'permission-bundle.created', 'permission-bundle.updated', 'sensitive-access.decided'
  )),
  ADD CONSTRAINT organization_audit_events_rule_revision_check CHECK (
    rule_revision IS NULL OR rule_revision > 0
  ),
  ADD CONSTRAINT organization_audit_events_resulting_permissions_check CHECK (
    resulting_permissions IS NULL OR (
      cardinality(resulting_permissions) <= 100
      AND array_position(resulting_permissions, NULL) IS NULL
      AND length(array_to_string(resulting_permissions, ',')) <= 20000
    )
  ),
  ADD CONSTRAINT organization_audit_events_context_check CHECK (
    (
      event_type IN ('group.assigned', 'group.revoked', 'group.refreshed')
      AND group_id IS NOT NULL AND assignment_id IS NOT NULL AND target_user_id IS NOT NULL
      AND assignment_source IN ('manual', 'compliance', 'rule')
      AND (
        (assignment_source = 'manual' AND compliance_source IS NULL
          AND rule_revision IS NULL AND resulting_permissions IS NULL)
        OR (assignment_source = 'compliance' AND compliance_source IS NOT NULL
          AND rule_revision IS NULL AND resulting_permissions IS NULL)
        OR (assignment_source = 'rule' AND compliance_source IS NULL
          AND rule_revision > 0 AND resulting_permissions IS NOT NULL)
      )
      AND (event_type <> 'group.refreshed' OR assignment_source = 'rule')
      AND section_id IS NULL AND target_character_id IS NULL AND disclosure_version IS NULL
    ) OR (
      event_type IN ('group-rule.created', 'group-rule.updated', 'group-rule.disabled')
      AND group_id IS NOT NULL AND subject_type = 'group' AND subject_id = group_id::text
      AND actor_type = 'user' AND rule_revision > 0 AND resulting_permissions IS NOT NULL
      AND assignment_id IS NULL AND target_user_id IS NULL AND assignment_source IS NULL
      AND compliance_source IS NULL AND entitlement_expires_at IS NULL
      AND section_id IS NULL AND target_character_id IS NULL AND disclosure_version IS NULL
    ) OR (
      event_type = 'sensitive-access.decided'
      AND actor_type = 'user' AND outcome IN ('granted', 'denied')
      AND section_id IN ('skills', 'assets', 'wallet', 'mail')
      AND disclosure_version > 0
      AND (target_character_id IS NULL OR (target_character_id > 0 AND target_user_id IS NOT NULL))
      AND group_id IS NULL AND assignment_id IS NULL AND assignment_source IS NULL
      AND compliance_source IS NULL AND entitlement_expires_at IS NULL
      AND rule_revision IS NULL AND resulting_permissions IS NULL
      AND causation_audit_id IS NULL
      AND (
        (outcome = 'granted' AND reason = 'authorized'
          AND target_user_id IS NOT NULL AND subject_type = 'user'
          AND subject_id = target_user_id::text)
        OR (outcome = 'denied' AND reason IN (
          'reviewer-blocked', 'reviewer-compliance-required',
          'reviewer-authority-required', 'reviewer-permission-required',
          'target-not-authorized'
        ) AND (
          (reason = 'target-not-authorized' AND target_user_id IS NULL
            AND target_character_id IS NULL AND subject_type = 'deployment'
            AND subject_id = '1')
          OR (reason <> 'target-not-authorized' AND target_user_id IS NOT NULL
            AND subject_type = 'user' AND subject_id = target_user_id::text)
          OR (reason <> 'target-not-authorized' AND target_user_id IS NULL
            AND target_character_id IS NULL AND subject_type = 'deployment'
            AND subject_id = '1')
        ))
      )
    ) OR (
      event_type NOT IN (
        'group.assigned', 'group.revoked', 'group.refreshed',
        'group-rule.created', 'group-rule.updated', 'group-rule.disabled',
        'sensitive-access.decided'
      )
      AND group_id IS NULL AND assignment_id IS NULL AND target_user_id IS NULL
      AND assignment_source IS NULL AND compliance_source IS NULL
      AND entitlement_expires_at IS NULL AND section_id IS NULL
      AND target_character_id IS NULL AND disclosure_version IS NULL
      AND rule_revision IS NULL AND resulting_permissions IS NULL
    )
  );

CREATE TABLE organization_rule_audit_sources (
  audit_id uuid NOT NULL,
  source_kind text NOT NULL,
  source_id uuid NOT NULL,
  role_revision uuid,
  valid_until timestamptz,
  CONSTRAINT organization_rule_audit_sources_pkey PRIMARY KEY (audit_id, source_kind, source_id),
  CONSTRAINT organization_rule_audit_sources_audit_fkey FOREIGN KEY (audit_id)
    REFERENCES organization_audit_events (audit_id) ON DELETE RESTRICT,
  CONSTRAINT organization_rule_audit_sources_kind_check CHECK (
    source_kind IN ('registration', 'explicit-director', 'derived-director', 'corporation-role')
  ),
  CONSTRAINT organization_rule_audit_sources_revision_check CHECK (
    (source_kind IN ('registration', 'explicit-director') AND role_revision IS NULL)
    OR (source_kind IN ('derived-director', 'corporation-role') AND role_revision IS NOT NULL)
  )
);

CREATE TRIGGER organization_rule_audit_sources_append_only
  BEFORE UPDATE OR DELETE ON organization_rule_audit_sources
  FOR EACH ROW EXECUTE FUNCTION enforce_organization_group_rule_history();
