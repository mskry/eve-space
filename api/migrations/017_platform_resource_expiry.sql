ALTER TABLE platform_collection_state
  ADD COLUMN cached_until timestamptz,
  ADD CONSTRAINT platform_collection_state_cached_until_check CHECK (
    cached_until IS NULL OR (validated_at IS NOT NULL AND cached_until >= validated_at)
  );

CREATE FUNCTION platform_current_observation_state(
  validated_at timestamptz,
  cached_until timestamptz,
  effective_at timestamptz
) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN validated_at IS NULL THEN 'never-collected'
    WHEN cached_until IS NULL
      OR cached_until <= effective_at
      OR validated_at + interval '24 hours' <= effective_at THEN 'unavailable'
    ELSE 'current'
  END
$$;
