create function eve_module_member_audit.persist_purge_evidence(input jsonb)
returns jsonb
language sql
volatile
parallel unsafe
begin atomic
  with legacy as (
    delete from skill_snapshots
    where ctid in (
      select ctid from skill_snapshots
      where input ->> 'store'::text = 'legacy-skills'::text
        and (
          (
            input ->> 'mode'::text = 'retention'::text
            and validated_at <= (input ->> 'cutoff'::text)::timestamptz
          )
          or (
            input ->> 'mode'::text <> 'retention'::text
        and case input ->> 'mode'::text
          when 'account'::text then target_user_id = (input ->> 'targetUserId'::text)::uuid
          else
            organization_version = (input ->> 'organizationVersion'::text)::bigint
            and (
              input ->> 'mode'::text = 'organization'::text
              or target_user_id = (input ->> 'targetUserId'::text)::uuid
            )
        end
            and (
              input ->> 'mode'::text <> 'authority'::text
              or (
                managed_member_lifecycle_id = (input ->> 'managedMemberLifecycleId'::text)::uuid
                and character_id = (input ->> 'characterId'::text)::bigint
                and character_lifecycle_id = (input ->> 'characterLifecycleId'::text)::uuid
                and authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
                and disclosure_version = (input ->> 'disclosureVersion'::text)::integer
                and section_activation_version = (input ->> 'sectionActivationVersion'::text)::integer
              )
            )
          )
        )
      limit (input ->> 'limit'::text)::integer
    )
    returning 1
  ), trained as (
    delete from trained_skill_snapshots
    where ctid in (
      select ctid from trained_skill_snapshots
      where input ->> 'store'::text = 'trained-skills'::text
        and input ->> 'mode'::text <> 'retention'::text
        and case input ->> 'mode'::text
          when 'account'::text then target_user_id = (input ->> 'targetUserId'::text)::uuid
          else
            organization_version = (input ->> 'organizationVersion'::text)::bigint
            and (
              input ->> 'mode'::text = 'organization'::text
              or target_user_id = (input ->> 'targetUserId'::text)::uuid
            )
        end
        and (
          input ->> 'mode'::text <> 'authority'::text
          or (
            managed_member_lifecycle_id = (input ->> 'managedMemberLifecycleId'::text)::uuid
            and character_id = (input ->> 'characterId'::text)::bigint
            and character_lifecycle_id = (input ->> 'characterLifecycleId'::text)::uuid
            and authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
            and disclosure_version = (input ->> 'disclosureVersion'::text)::integer
            and section_activation_version = (input ->> 'sectionActivationVersion'::text)::integer
          )
        )
      limit (input ->> 'limit'::text)::integer
    )
    returning 1
  ), queue as (
    delete from skill_queue_snapshots
    where ctid in (
      select ctid from skill_queue_snapshots
      where input ->> 'store'::text = 'skill-queue'::text
        and input ->> 'mode'::text <> 'retention'::text
        and case input ->> 'mode'::text
          when 'account'::text then target_user_id = (input ->> 'targetUserId'::text)::uuid
          else
            organization_version = (input ->> 'organizationVersion'::text)::bigint
            and (
              input ->> 'mode'::text = 'organization'::text
              or target_user_id = (input ->> 'targetUserId'::text)::uuid
            )
        end
        and (
          input ->> 'mode'::text <> 'authority'::text
          or (
            managed_member_lifecycle_id = (input ->> 'managedMemberLifecycleId'::text)::uuid
            and character_id = (input ->> 'characterId'::text)::bigint
            and character_lifecycle_id = (input ->> 'characterLifecycleId'::text)::uuid
            and authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
            and disclosure_version = (input ->> 'disclosureVersion'::text)::integer
            and section_activation_version = (input ->> 'sectionActivationVersion'::text)::integer
          )
        )
      limit (input ->> 'limit'::text)::integer
    )
    returning 1
  ), assets as (
    delete from asset_snapshots
    where ctid in (
      select ctid from asset_snapshots
      where input ->> 'store'::text = 'assets'::text
        and input ->> 'mode'::text <> 'retention'::text
        and case input ->> 'mode'::text
          when 'account'::text then target_user_id = (input ->> 'targetUserId'::text)::uuid
          else
            organization_version = (input ->> 'organizationVersion'::text)::bigint
            and (
              input ->> 'mode'::text = 'organization'::text
              or target_user_id = (input ->> 'targetUserId'::text)::uuid
            )
        end
        and (
          input ->> 'mode'::text <> 'authority'::text
          or (
            managed_member_lifecycle_id = (input ->> 'managedMemberLifecycleId'::text)::uuid
            and character_id = (input ->> 'characterId'::text)::bigint
            and character_lifecycle_id = (input ->> 'characterLifecycleId'::text)::uuid
            and authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
            and disclosure_version = (input ->> 'disclosureVersion'::text)::integer
            and section_activation_version = (input ->> 'sectionActivationVersion'::text)::integer
          )
        )
      limit (input ->> 'limit'::text)::integer
    )
    returning 1
  ), balance as (
    delete from wallet_balance_snapshots
    where ctid in (
      select ctid from wallet_balance_snapshots
      where input ->> 'store'::text = 'wallet-balance'::text
        and input ->> 'mode'::text <> 'retention'::text
        and case input ->> 'mode'::text
          when 'account'::text then target_user_id = (input ->> 'targetUserId'::text)::uuid
          else
            organization_version = (input ->> 'organizationVersion'::text)::bigint
            and (
              input ->> 'mode'::text = 'organization'::text
              or target_user_id = (input ->> 'targetUserId'::text)::uuid
            )
        end
        and (
          input ->> 'mode'::text <> 'authority'::text
          or (
            managed_member_lifecycle_id = (input ->> 'managedMemberLifecycleId'::text)::uuid
            and character_id = (input ->> 'characterId'::text)::bigint
            and character_lifecycle_id = (input ->> 'characterLifecycleId'::text)::uuid
            and authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
            and disclosure_version = (input ->> 'disclosureVersion'::text)::integer
            and section_activation_version = (input ->> 'sectionActivationVersion'::text)::integer
          )
        )
      limit (input ->> 'limit'::text)::integer
    )
    returning 1
  ), journal as (
    delete from wallet_journal_records
    where ctid in (
      select ctid from wallet_journal_records
      where input ->> 'store'::text = 'wallet-journal'::text
        and (
          (
            input ->> 'mode'::text = 'retention'::text
            and expires_at <= (input ->> 'cutoff'::text)::timestamptz
          )
          or (
            input ->> 'mode'::text <> 'retention'::text
            and case input ->> 'mode'::text
              when 'account'::text then
                target_user_id = (input ->> 'targetUserId'::text)::uuid
              else
                organization_version = (input ->> 'organizationVersion'::text)::bigint
                and (
                  input ->> 'mode'::text = 'organization'::text
                  or target_user_id = (input ->> 'targetUserId'::text)::uuid
                )
            end
            and (
              input ->> 'mode'::text <> 'authority'::text
              or (
                managed_member_lifecycle_id = (input ->> 'managedMemberLifecycleId'::text)::uuid
                and character_id = (input ->> 'characterId'::text)::bigint
                and character_lifecycle_id = (input ->> 'characterLifecycleId'::text)::uuid
                and authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
                and disclosure_version = (input ->> 'disclosureVersion'::text)::integer
                and section_activation_version = (input ->> 'sectionActivationVersion'::text)::integer
              )
            )
          )
        )
      limit (input ->> 'limit'::text)::integer
    )
    returning 1
  ), transactions as (
    delete from wallet_transaction_records
    where ctid in (
      select ctid from wallet_transaction_records
      where input ->> 'store'::text = 'wallet-transactions'::text
        and (
          (
            input ->> 'mode'::text = 'retention'::text
            and expires_at <= (input ->> 'cutoff'::text)::timestamptz
          )
          or (
            input ->> 'mode'::text <> 'retention'::text
            and case input ->> 'mode'::text
              when 'account'::text then
                target_user_id = (input ->> 'targetUserId'::text)::uuid
              else
                organization_version = (input ->> 'organizationVersion'::text)::bigint
                and (
                  input ->> 'mode'::text = 'organization'::text
                  or target_user_id = (input ->> 'targetUserId'::text)::uuid
                )
            end
            and (
              input ->> 'mode'::text <> 'authority'::text
              or (
                managed_member_lifecycle_id = (input ->> 'managedMemberLifecycleId'::text)::uuid
                and character_id = (input ->> 'characterId'::text)::bigint
                and character_lifecycle_id = (input ->> 'characterLifecycleId'::text)::uuid
                and authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
                and disclosure_version = (input ->> 'disclosureVersion'::text)::integer
                and section_activation_version = (input ->> 'sectionActivationVersion'::text)::integer
              )
            )
          )
        )
      limit (input ->> 'limit'::text)::integer
    )
    returning 1
  ), headers as (
    delete from mail_headers
    where ctid in (
      select ctid from mail_headers
      where input ->> 'store'::text = 'mail-headers'::text
        and (
          (
            input ->> 'mode'::text = 'retention'::text
            and expires_at <= (input ->> 'cutoff'::text)::timestamptz
          )
          or (
            input ->> 'mode'::text <> 'retention'::text
            and case input ->> 'mode'::text
              when 'account'::text then
                target_user_id = (input ->> 'targetUserId'::text)::uuid
              else
                organization_version = (input ->> 'organizationVersion'::text)::bigint
                and (
                  input ->> 'mode'::text = 'organization'::text
                  or target_user_id = (input ->> 'targetUserId'::text)::uuid
                )
            end
            and (
              input ->> 'mode'::text <> 'authority'::text
              or (
                managed_member_lifecycle_id = (input ->> 'managedMemberLifecycleId'::text)::uuid
                and character_id = (input ->> 'characterId'::text)::bigint
                and character_lifecycle_id = (input ->> 'characterLifecycleId'::text)::uuid
                and authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
                and disclosure_version = (input ->> 'disclosureVersion'::text)::integer
                and section_activation_version = (input ->> 'sectionActivationVersion'::text)::integer
              )
            )
          )
        )
      limit (input ->> 'limit'::text)::integer
    )
    returning 1
  ), contents as (
    delete from mail_contents
    where ctid in (
      select ctid from mail_contents
      where input ->> 'store'::text = 'mail-contents'::text
        and (
          (
            input ->> 'mode'::text = 'retention'::text
            and expires_at <= (input ->> 'cutoff'::text)::timestamptz
          )
          or (
            input ->> 'mode'::text <> 'retention'::text
            and case input ->> 'mode'::text
              when 'account'::text then
                target_user_id = (input ->> 'targetUserId'::text)::uuid
              else
                organization_version = (input ->> 'organizationVersion'::text)::bigint
                and (
                  input ->> 'mode'::text = 'organization'::text
                  or target_user_id = (input ->> 'targetUserId'::text)::uuid
                )
            end
            and (
              input ->> 'mode'::text <> 'authority'::text
              or (
                managed_member_lifecycle_id = (input ->> 'managedMemberLifecycleId'::text)::uuid
                and character_id = (input ->> 'characterId'::text)::bigint
                and character_lifecycle_id = (input ->> 'characterLifecycleId'::text)::uuid
                and authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
                and disclosure_version = (input ->> 'disclosureVersion'::text)::integer
                and section_activation_version = (input ->> 'sectionActivationVersion'::text)::integer
              )
            )
          )
        )
      limit (input ->> 'limit'::text)::integer
    )
    returning 1
  ), continuations as (
    delete from collection_continuations
    where ctid in (
      select ctid from collection_continuations
      where input ->> 'store'::text = 'continuations'::text
        and (
          (
            input ->> 'mode'::text = 'retention'::text
            and updated_at <= (input ->> 'cutoff'::text)::timestamptz
          )
          or (
            input ->> 'mode'::text <> 'retention'::text
            and case input ->> 'mode'::text
              when 'account'::text then
                target_user_id = (input ->> 'targetUserId'::text)::uuid
              else
                organization_version = (input ->> 'organizationVersion'::text)::bigint
                and (
                  input ->> 'mode'::text = 'organization'::text
                  or target_user_id = (input ->> 'targetUserId'::text)::uuid
                )
            end
            and (
              input ->> 'mode'::text <> 'authority'::text
              or (
                managed_member_lifecycle_id = (input ->> 'managedMemberLifecycleId'::text)::uuid
                and character_id = (input ->> 'characterId'::text)::bigint
                and character_lifecycle_id = (input ->> 'characterLifecycleId'::text)::uuid
                and authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
                and disclosure_version = (input ->> 'disclosureVersion'::text)::integer
                and section_activation_version = (input ->> 'sectionActivationVersion'::text)::integer
              )
            )
          )
        )
      limit (input ->> 'limit'::text)::integer
    )
    returning 1
  ), staging as (
    delete from observation_staging
    where ctid in (
      select ctid from observation_staging
      where input ->> 'store'::text = 'staging'::text
        and (
          (
            input ->> 'mode'::text = 'retention'::text
            and validated_at <= (input ->> 'cutoff'::text)::timestamptz
          )
          or (
            input ->> 'mode'::text <> 'retention'::text
            and case input ->> 'mode'::text
              when 'account'::text then
                target_user_id = (input ->> 'targetUserId'::text)::uuid
              else
                organization_version = (input ->> 'organizationVersion'::text)::bigint
                and (
                  input ->> 'mode'::text = 'organization'::text
                  or target_user_id = (input ->> 'targetUserId'::text)::uuid
                )
            end
            and (
              input ->> 'mode'::text <> 'authority'::text
              or (
                managed_member_lifecycle_id = (input ->> 'managedMemberLifecycleId'::text)::uuid
                and character_id = (input ->> 'characterId'::text)::bigint
                and character_lifecycle_id = (input ->> 'characterLifecycleId'::text)::uuid
                and authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
                and disclosure_version = (input ->> 'disclosureVersion'::text)::integer
                and section_activation_version = (input ->> 'sectionActivationVersion'::text)::integer
              )
            )
          )
        )
      limit (input ->> 'limit'::text)::integer
    )
    returning 1
  ), promotions as (
    delete from promoted_observations
    where ctid in (
      select ctid from promoted_observations
      where input ->> 'store'::text = 'promotions'::text
        and (
          (
            input ->> 'mode'::text = 'retention'::text
            and promoted_at <= (input ->> 'cutoff'::text)::timestamptz
          )
          or (
            input ->> 'mode'::text <> 'retention'::text
            and case input ->> 'mode'::text
              when 'account'::text then
                target_user_id = (input ->> 'targetUserId'::text)::uuid
              else
                organization_version = (input ->> 'organizationVersion'::text)::bigint
                and (
                  input ->> 'mode'::text = 'organization'::text
                  or target_user_id = (input ->> 'targetUserId'::text)::uuid
                )
            end
            and (
              input ->> 'mode'::text <> 'authority'::text
              or (
                managed_member_lifecycle_id = (input ->> 'managedMemberLifecycleId'::text)::uuid
                and character_id = (input ->> 'characterId'::text)::bigint
                and character_lifecycle_id = (input ->> 'characterLifecycleId'::text)::uuid
                and authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
                and disclosure_version = (input ->> 'disclosureVersion'::text)::integer
                and section_activation_version = (input ->> 'sectionActivationVersion'::text)::integer
              )
            )
          )
        )
      limit (input ->> 'limit'::text)::integer
    )
    returning 1
  ), counts as (
    select
      (select count(*) from legacy)
      + (select count(*) from trained)
      + (select count(*) from queue)
      + (select count(*) from assets)
      + (select count(*) from balance)
      + (select count(*) from journal)
      + (select count(*) from transactions)
      + (select count(*) from headers)
      + (select count(*) from contents)
      + (select count(*) from continuations)
      + (select count(*) from staging)
      + (select count(*) from promotions) as deleted
  )
  select jsonb_build_object(
    'deleted'::text,
    deleted,
    'remaining'::text,
    deleted = (input ->> 'limit'::text)::integer
  ) as result
  from counts;
end;
