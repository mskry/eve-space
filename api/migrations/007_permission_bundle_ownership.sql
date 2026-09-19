ALTER TABLE organization_permission_bundle_entries
  DROP CONSTRAINT organization_permission_bundle_entries_pkey,
  ADD COLUMN entry_id uuid DEFAULT gen_random_uuid() NOT NULL,
  ADD COLUMN publisher_package text,
  ADD COLUMN module_id text;

UPDATE organization_permission_bundle_entries
SET publisher_package = '@eve-space/organization-activity-manifest',
  module_id = 'organization-activity', review_allowed = false
WHERE permission_type = 'module' AND permission_key = 'organization-activity.view';

UPDATE organization_permission_bundle_entries
SET publisher_package = '@eve-space/member-audit-manifest',
  module_id = 'member-audit', review_allowed = false
WHERE permission_type = 'module' AND permission_key IN (
  'member-audit.search',
  'member-audit.summary.read',
  'member-audit.skills.read',
  'member-audit.assets.read',
  'member-audit.wallet.read',
  'member-audit.mail.read',
  'member-audit.groups.manage',
  'member-audit.members.block'
);

ALTER TABLE organization_permission_bundle_entries
  ADD CONSTRAINT organization_permission_bundle_entries_pkey PRIMARY KEY (entry_id),
  ADD CONSTRAINT organization_permission_bundle_entries_ownership_check CHECK (
    (permission_type = 'service' AND publisher_package IS NULL AND module_id IS NULL)
    OR (
      permission_type = 'module'
      AND (
        (publisher_package IS NULL AND module_id IS NULL)
        OR (
          publisher_package = trim(publisher_package)
          AND length(publisher_package) BETWEEN 1 AND 214
          AND module_id IS NOT NULL
          AND is_valid_module_id(module_id)
        )
      )
    )
  );

CREATE UNIQUE INDEX organization_permission_bundle_entries_service_key
  ON organization_permission_bundle_entries (bundle_id, permission_key)
  WHERE permission_type = 'service';

CREATE UNIQUE INDEX organization_permission_bundle_entries_module_key
  ON organization_permission_bundle_entries (
    bundle_id, publisher_package, module_id, permission_key
  )
  WHERE permission_type = 'module' AND publisher_package IS NOT NULL;

CREATE UNIQUE INDEX organization_permission_bundle_entries_legacy_module_key
  ON organization_permission_bundle_entries (bundle_id, permission_key)
  WHERE permission_type = 'module' AND publisher_package IS NULL;

ALTER TABLE organization_audit_events
  DROP CONSTRAINT organization_audit_events_type_check,
  DROP CONSTRAINT organization_audit_events_subject_type_check;

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
    'permission-bundle.created',
    'permission-bundle.updated',
    'sensitive-access.decided'
  )),
  ADD CONSTRAINT organization_audit_events_subject_type_check CHECK (subject_type IN (
    'deployment',
    'user',
    'character',
    'role_grant',
    'exception',
    'compliance',
    'corporation_source',
    'managed_corporation',
    'group',
    'permission_bundle',
    'external_service'
  ));
