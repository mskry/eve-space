CREATE SEQUENCE organization_alliance_executor_observation_sequence AS bigint START WITH 1 NO CYCLE;

CREATE TABLE organization_alliance_executor_observations (
  deployment_id smallint DEFAULT 1 NOT NULL,
  organization_version bigint NOT NULL,
  alliance_id bigint NOT NULL,
  executor_corporation_id bigint,
  executor_revision uuid,
  status text DEFAULT 'pending' NOT NULL,
  validated_at timestamptz,
  fresh_until timestamptz,
  next_refresh_at timestamptz NOT NULL,
  last_applied_sequence bigint DEFAULT 0 NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT organization_alliance_executor_observations_pkey
    PRIMARY KEY (deployment_id, organization_version),
  CONSTRAINT organization_alliance_executor_observations_epoch_fkey
    FOREIGN KEY (deployment_id, organization_version, alliance_id)
    REFERENCES organization_epochs (deployment_id, organization_version, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT organization_alliance_executor_observations_identity_check CHECK (alliance_id > 0),
  CONSTRAINT organization_alliance_executor_observations_sequence_check CHECK (
    last_applied_sequence >= 0
  ),
  CONSTRAINT organization_alliance_executor_observations_state_check CHECK (
    (status = 'pending' AND executor_corporation_id IS NULL
      AND executor_revision IS NULL AND validated_at IS NULL AND fresh_until IS NULL)
    OR (status = 'fresh' AND executor_corporation_id > 0
      AND executor_revision IS NOT NULL AND validated_at IS NOT NULL
      AND fresh_until > validated_at)
    OR (status = 'invalid' AND executor_corporation_id IS NULL
      AND executor_revision IS NOT NULL AND validated_at IS NOT NULL
      AND fresh_until > validated_at)
  )
);

CREATE INDEX organization_alliance_executor_observations_due_idx
  ON organization_alliance_executor_observations (next_refresh_at, organization_version);

ALTER TABLE organization_group_rule_attestations
  ADD COLUMN executor_revision uuid,
  ADD COLUMN executor_fresh_until timestamptz,
  ADD CONSTRAINT organization_group_rule_attestations_executor_check CHECK (
    (executor_revision IS NULL AND executor_fresh_until IS NULL)
    OR (source_kind IN ('corporation-role', 'derived-director')
      AND executor_revision IS NOT NULL AND executor_fresh_until IS NOT NULL)
  );
