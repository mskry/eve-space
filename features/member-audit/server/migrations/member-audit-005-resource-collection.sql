delete from eve_module_member_audit.skill_queue_snapshots;

create function eve_module_member_audit.persist_read_trained_skills_evidence(input jsonb)
returns jsonb
language sql
stable
parallel unsafe
begin atomic
  select jsonb_build_object(
    'trainedSkills'::text,
    (
      select jsonb_build_object(
        'observationId'::text, trained.observation_id,
        'dtoRevision'::text, trained.dto_revision,
        'validatedAt'::text, trained.validated_at,
        'snapshot'::text, trained.snapshot
      )
      from eve_module_member_audit.trained_skill_snapshots as trained
      where trained.organization_version = (input ->> 'organizationVersion'::text)::bigint
        and trained.target_user_id = (input ->> 'targetUserId'::text)::uuid
        and trained.managed_member_lifecycle_id = (input ->> 'managedMemberLifecycleId'::text)::uuid
        and trained.character_id = (input ->> 'characterId'::text)::bigint
        and trained.character_lifecycle_id = (input ->> 'characterLifecycleId'::text)::uuid
        and trained.authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
        and trained.disclosure_version = (input ->> 'disclosureVersion'::text)::integer
        and trained.section_activation_version = (input ->> 'sectionActivationVersion'::text)::integer
    )
  ) as result;
end;

create function eve_module_member_audit.persist_read_active_evidence_continuation(input jsonb)
returns jsonb
language sql
stable
parallel unsafe
begin atomic
  select jsonb_build_object(
    'observationId'::text, continuation.observation_id,
    'revision'::text, continuation.revision,
    'checkpoint'::text, continuation.checkpoint
  ) as result
  from eve_module_member_audit.collection_continuations as continuation
  where continuation.section_id = input ->> 'sectionId'::text
    and continuation.resource_id = input ->> 'resourceId'::text
    and continuation.operation_contract_revision = (input ->> 'operationContractRevision'::text)::integer
    and continuation.resource_revision = (input ->> 'resourceRevision'::text)::integer
    and continuation.organization_version = (input ->> 'organizationVersion'::text)::bigint
    and continuation.target_user_id = (input ->> 'targetUserId'::text)::uuid
    and continuation.managed_member_lifecycle_id = (input ->> 'managedMemberLifecycleId'::text)::uuid
    and continuation.character_id = (input ->> 'characterId'::text)::bigint
    and continuation.character_lifecycle_id = (input ->> 'characterLifecycleId'::text)::uuid
    and continuation.authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
    and continuation.disclosure_version = (input ->> 'disclosureVersion'::text)::integer
    and continuation.section_activation_version = (input ->> 'sectionActivationVersion'::text)::integer;
end;
