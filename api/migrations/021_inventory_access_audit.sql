CREATE TABLE organization_inventory_access_audit (
  audit_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL,
  organization_version bigint NOT NULL CHECK (organization_version > 0),
  policy_version bigint NOT NULL CHECK (policy_version > 0),
  corporation_id bigint CHECK (corporation_id > 0),
  access_kind text NOT NULL CHECK (access_kind IN ('aggregate', 'holders')),
  decision text NOT NULL CHECK (decision IN ('allowed', 'denied')),
  reason text NOT NULL CHECK (reason IN ('authorized', 'scope-denied', 'permission-denied', 'authority-changed', 'source-unavailable', 'limit')),
  section_id text NOT NULL DEFAULT 'assets' CHECK (section_id = 'assets'),
  disclosure_revision integer NOT NULL CHECK (disclosure_revision >= 0),
  section_activation_revision integer NOT NULL CHECK (section_activation_revision >= 0),
  subjects jsonb NOT NULL CHECK (jsonb_typeof(subjects) = 'array' AND jsonb_array_length(subjects) <= 250),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((decision = 'allowed' AND reason = 'authorized' AND corporation_id IS NOT NULL AND disclosure_revision > 0)
    OR (decision = 'denied' AND reason <> 'authorized' AND corporation_id IS NULL AND subjects = '[]'::jsonb))
);

CREATE INDEX organization_inventory_access_actor_idx
  ON organization_inventory_access_audit (organization_version, actor_user_id, occurred_at);
CREATE TRIGGER organization_inventory_access_append_only
  BEFORE DELETE OR UPDATE ON organization_inventory_access_audit
  FOR EACH ROW EXECUTE FUNCTION prevent_organization_audit_mutation();
