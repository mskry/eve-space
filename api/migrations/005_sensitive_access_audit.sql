ALTER TABLE organization_audit_events
  ADD COLUMN section_id text,
  ADD COLUMN target_character_id bigint,
  ADD COLUMN disclosure_version bigint;

ALTER TABLE organization_audit_events
  DROP CONSTRAINT organization_audit_events_type_check,
  DROP CONSTRAINT organization_audit_events_group_assignment_check;

ALTER TABLE organization_audit_events
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
    'group.assigned',
    'group.revoked',
    'member.blocked',
    'member.unblocked',
    'sensitive-access.decided'
  )),
  ADD CONSTRAINT organization_audit_events_context_check CHECK (
    (
      event_type IN ('group.assigned', 'group.revoked')
      AND group_id IS NOT NULL
      AND assignment_id IS NOT NULL
      AND target_user_id IS NOT NULL
      AND assignment_source IN ('manual', 'compliance')
      AND (
        (assignment_source = 'manual' AND compliance_source IS NULL)
        OR (assignment_source = 'compliance' AND compliance_source IS NOT NULL)
      )
      AND section_id IS NULL
      AND target_character_id IS NULL
      AND disclosure_version IS NULL
    ) OR (
      event_type = 'sensitive-access.decided'
      AND actor_type = 'user'
      AND outcome IN ('granted', 'denied')
      AND section_id IS NOT NULL
      AND section_id IN ('skills', 'assets', 'wallet', 'mail')
      AND disclosure_version IS NOT NULL
      AND disclosure_version > 0
      AND (target_character_id IS NULL OR (target_character_id > 0 AND target_user_id IS NOT NULL))
      AND group_id IS NULL
      AND assignment_id IS NULL
      AND assignment_source IS NULL
      AND compliance_source IS NULL
      AND entitlement_expires_at IS NULL
      AND causation_audit_id IS NULL
      AND (
        (
          outcome = 'granted'
          AND reason = 'authorized'
          AND target_user_id IS NOT NULL
          AND subject_type = 'user'
          AND subject_id = target_user_id::text
        ) OR (
          outcome = 'denied'
          AND reason IN (
            'reviewer-blocked',
            'reviewer-compliance-required',
            'reviewer-authority-required',
            'reviewer-permission-required',
            'target-not-authorized'
          )
          AND (
            (
              reason = 'target-not-authorized'
              AND target_user_id IS NULL
              AND target_character_id IS NULL
              AND subject_type = 'deployment'
              AND subject_id = '1'
            ) OR (
              reason <> 'target-not-authorized'
              AND target_user_id IS NOT NULL
              AND subject_type = 'user'
              AND subject_id = target_user_id::text
            ) OR (
              reason <> 'target-not-authorized'
              AND target_user_id IS NULL
              AND target_character_id IS NULL
              AND subject_type = 'deployment'
              AND subject_id = '1'
            )
          )
        )
      )
    ) OR (
      event_type NOT IN ('group.assigned', 'group.revoked', 'sensitive-access.decided')
      AND group_id IS NULL
      AND assignment_id IS NULL
      AND target_user_id IS NULL
      AND assignment_source IS NULL
      AND compliance_source IS NULL
      AND entitlement_expires_at IS NULL
      AND section_id IS NULL
      AND target_character_id IS NULL
      AND disclosure_version IS NULL
    )
  );
