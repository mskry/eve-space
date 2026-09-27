ALTER TABLE platform_subject_lifecycles
  ADD CONSTRAINT platform_subject_lifecycles_lifecycle_character_key
    UNIQUE (subject_lifecycle_id, character_id);

CREATE TABLE pending_character_tokens (
  character_id bigint PRIMARY KEY,
  user_id uuid NOT NULL,
  subject_lifecycle_id uuid NOT NULL,
  base_token_version integer NOT NULL,
  attempt_id uuid NOT NULL DEFAULT gen_random_uuid(),
  encrypted_tokens text NOT NULL,
  access_token_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pending_character_tokens_base_version_check CHECK (base_token_version >= 0),
  CONSTRAINT pending_character_tokens_encrypted_tokens_check CHECK (length(encrypted_tokens) > 0),
  CONSTRAINT pending_character_tokens_verified_token_fkey
    FOREIGN KEY (character_id) REFERENCES eve_tokens(character_id) ON DELETE CASCADE,
  CONSTRAINT pending_character_tokens_owner_fkey
    FOREIGN KEY (user_id, character_id) REFERENCES characters(user_id, character_id) ON DELETE CASCADE,
  CONSTRAINT pending_character_tokens_lifecycle_fkey
    FOREIGN KEY (subject_lifecycle_id, character_id)
    REFERENCES platform_subject_lifecycles(subject_lifecycle_id, character_id) ON DELETE CASCADE
);
