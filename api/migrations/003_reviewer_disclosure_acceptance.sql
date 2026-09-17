ALTER TABLE oauth_states
  ADD COLUMN reviewer_use_disclosures jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD CONSTRAINT oauth_states_reviewer_use_disclosures_check CHECK (
    jsonb_typeof(reviewer_use_disclosures) = 'array'
    AND jsonb_array_length(reviewer_use_disclosures) <= 64
  );

CREATE TABLE character_reviewer_disclosure_acceptances (
  character_id bigint NOT NULL,
  module_id text NOT NULL,
  section_id text NOT NULL,
  disclosure_version integer NOT NULL,
  authorization_generation integer NOT NULL,
  accepted_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT character_reviewer_disclosure_acceptances_pkey
    PRIMARY KEY (character_id, module_id, section_id),
  CONSTRAINT character_reviewer_disclosure_acceptances_character_id_fkey
    FOREIGN KEY (character_id) REFERENCES eve_tokens(character_id) ON DELETE CASCADE,
  CONSTRAINT character_reviewer_disclosure_acceptances_section_fkey
    FOREIGN KEY (module_id, section_id)
    REFERENCES deployment_module_sections(module_id, section_id) ON DELETE CASCADE,
  CONSTRAINT character_reviewer_disclosure_acceptances_versions_check
    CHECK (disclosure_version > 0 AND authorization_generation >= 0)
);
