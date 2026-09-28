DO $$
DECLARE
  definition text;
  old_section text := 'section_id = ANY (ARRAY[''skills''::text, ''assets''::text, ''wallet''::text, ''mail''::text])';
  new_section text := 'section_id = ANY (ARRAY[''skills''::text, ''assets''::text, ''wallet''::text, ''mail''::text, ''current-observation''::text])';
  expression text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO definition
  FROM pg_constraint
  WHERE conrelid = 'organization_audit_events'::regclass
    AND conname = 'organization_audit_events_context_check';

  IF definition IS NULL OR strpos(definition, old_section) = 0
    OR strpos(substr(definition, strpos(definition, old_section) + length(old_section)), old_section) > 0 THEN
    RAISE EXCEPTION 'Unexpected sensitive access audit constraint';
  END IF;

  expression := substring(definition FROM 8 FOR length(definition) - 8);
  expression := replace(expression, old_section, new_section);
  ALTER TABLE organization_audit_events DROP CONSTRAINT organization_audit_events_context_check;
  EXECUTE format(
    'ALTER TABLE organization_audit_events ADD CONSTRAINT organization_audit_events_context_check CHECK (%s)',
    expression
  );
END $$;
