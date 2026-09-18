CREATE TABLE platform_resource_purge_work (
  purge_work_id uuid DEFAULT gen_random_uuid() PRIMARY KEY NOT NULL,
  module_id text NOT NULL,
  resource_id text NOT NULL,
  mode text NOT NULL,
  target_user_id uuid NOT NULL,
  organization_version bigint,
  managed_member_lifecycle_id uuid,
  character_id bigint,
  character_lifecycle_id uuid,
  authorization_generation integer,
  disclosure_version integer,
  section_activation_version integer,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT platform_resource_purge_work_module_id_fkey
    FOREIGN KEY (module_id) REFERENCES deployment_modules(module_id) ON DELETE RESTRICT,
  CONSTRAINT platform_resource_purge_work_mode_check
    CHECK (mode IN ('account', 'authority')),
  CONSTRAINT platform_resource_purge_work_identity_check CHECK (
    (
      mode = 'account'
      AND organization_version IS NULL
      AND managed_member_lifecycle_id IS NULL
      AND character_id IS NULL
      AND character_lifecycle_id IS NULL
      AND authorization_generation IS NULL
      AND disclosure_version IS NULL
      AND section_activation_version IS NULL
    ) OR (
      mode = 'authority'
      AND organization_version IS NOT NULL AND organization_version > 0
      AND managed_member_lifecycle_id IS NOT NULL
      AND character_id IS NOT NULL AND character_id > 0
      AND character_lifecycle_id IS NOT NULL
      AND authorization_generation IS NOT NULL AND authorization_generation >= 0
      AND disclosure_version IS NOT NULL AND disclosure_version > 0
      AND section_activation_version IS NOT NULL AND section_activation_version > 0
    )
  )
);

CREATE INDEX platform_resource_purge_work_resource_idx
  ON platform_resource_purge_work (module_id, resource_id, created_at);
