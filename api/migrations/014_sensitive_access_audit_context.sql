ALTER TABLE organization_audit_events
  ADD CONSTRAINT organization_audit_events_context_check_required CHECK (
    event_type <> 'sensitive-access.decided'
    OR (section_id IS NOT NULL AND disclosure_version IS NOT NULL)
  );
