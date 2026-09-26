CREATE TABLE organization_rule_audit_permissions (
  permission_id uuid DEFAULT gen_random_uuid() PRIMARY KEY NOT NULL,
  audit_id uuid NOT NULL,
  permission_type text NOT NULL,
  permission_key text NOT NULL,
  publisher_package text,
  module_id text,
  CONSTRAINT organization_rule_audit_permissions_audit_fkey FOREIGN KEY (audit_id)
    REFERENCES organization_audit_events (audit_id) ON DELETE RESTRICT,
  CONSTRAINT organization_rule_audit_permissions_type_check CHECK (
    (permission_type = 'service' AND publisher_package IS NULL AND module_id IS NULL)
    OR (permission_type = 'module' AND publisher_package IS NOT NULL
      AND module_id IS NOT NULL)
  ),
  CONSTRAINT organization_rule_audit_permissions_key_check CHECK (
    length(permission_key) BETWEEN 1 AND 200
  )
);

CREATE UNIQUE INDEX organization_rule_audit_permissions_identity_key
  ON organization_rule_audit_permissions (
    audit_id, permission_type, coalesce(publisher_package, ''),
    coalesce(module_id, ''), permission_key
  );

CREATE INDEX organization_rule_audit_permissions_page_idx
  ON organization_rule_audit_permissions (audit_id, permission_type, permission_key, permission_id);

CREATE TRIGGER organization_rule_audit_permissions_append_only
  BEFORE UPDATE OR DELETE ON organization_rule_audit_permissions
  FOR EACH ROW EXECUTE FUNCTION enforce_organization_group_rule_history();
