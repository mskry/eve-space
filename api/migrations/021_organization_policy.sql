alter table deployment_settings
  add column organization_version bigint not null default 1,
  add column strict_remediation_duration_seconds integer not null default 0,
  add column stale_evidence_grace_duration_seconds integer not null default 3600,
  add column required_registration_scopes jsonb not null default '[]'::jsonb,
  add constraint deployment_settings_organization_version_check
    check (organization_version > 0),
  add constraint deployment_settings_strict_remediation_duration_check
    check (
      strict_remediation_duration_seconds >= 0
      and strict_remediation_duration_seconds <= 2592000
    ),
  add constraint deployment_settings_stale_evidence_grace_duration_check
    check (
      stale_evidence_grace_duration_seconds >= 0
      and stale_evidence_grace_duration_seconds <= 86400
    ),
  add constraint deployment_settings_required_registration_scopes_array_check
    check (jsonb_typeof(required_registration_scopes) = 'array'),
  add constraint deployment_settings_required_registration_scopes_values_check
    check (
      not jsonb_path_exists(
        required_registration_scopes,
        '$[*] ? (@.type() != "string")'
      )
    );
