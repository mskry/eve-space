DELETE FROM oauth_states
WHERE intent IN ('reauthorize', 'claim-organization-owner');

ALTER TABLE oauth_states
  ADD COLUMN expected_subject_lifecycle_id uuid,
  ADD CONSTRAINT oauth_states_expected_lifecycle_context_check CHECK (
    (intent IN ('reauthorize', 'claim-organization-owner')) =
    (expected_subject_lifecycle_id IS NOT NULL)
  );
