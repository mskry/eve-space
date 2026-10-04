alter table market_history_collection_state add column attempted_at timestamptz;
create table market_history_sources (
  region_id bigint not null,
  type_id bigint not null,
  validated_at timestamptz not null,
  fresh_until timestamptz,
  source_state text not null check (source_state in ('legacy', 'supplied', 'empty')),
  response_count integer check (response_count between 0 and 1000),
  response_from date,
  response_through date,
  response_digest text,
  content_revision bigint not null default 0,
  last_attempt_at timestamptz not null,
  last_failure_class text,
  last_attempt_id uuid not null,
  primary key (region_id, type_id)
);
insert into market_history_sources (region_id, type_id, validated_at, source_state, last_attempt_at, last_attempt_id)
select region_id, type_id, max(validated_at), 'legacy', max(validated_at), '00000000-0000-0000-0000-000000000000'::uuid
from market_daily_history group by region_id, type_id;

create view market_history_eligible_targets as
select profile.profile_id, profile.revision as profile_revision, profile.region_id,
  target.type_id, bool_or(target.explicit) as explicit,
  max(target.policy_revision) as policy_revision, min(target.universe_id::text)::uuid as universe_id
from market_profiles as profile
join lateral (
  select watched.value::bigint as type_id, true as explicit, null::bigint as policy_revision, null::uuid as universe_id
  from jsonb_array_elements_text(profile.watched_type_ids) as watched(value)
  union all
  select demand.type_id, true, null::bigint, null::uuid
  from market_history_demands as demand
  where demand.profile_id = profile.profile_id and demand.profile_revision = profile.revision
  union all
  select target.type_id, false, policy.revision, universe.universe_id
  from market_intelligence_policies as policy
  join market_intelligence_universes as universe on universe.universe_id = policy.active_universe_id
  join market_intelligence_targets as target using (universe_id)
  where policy.profile_id = profile.profile_id and policy.enabled
    and profile.mode = 'region' and profile.region_id <> 19000001
    and universe.status = 'complete' and universe.profile_revision = profile.revision
    and universe.policy_revision = policy.revision
) as target on true
where profile.enabled
  and ((profile.region_id = 19000001 and target.type_id = 44992)
    or (profile.region_id <> 19000001 and target.type_id <> 44992))
group by profile.profile_id, profile.revision, profile.region_id, target.type_id;

create function eve_module_market.persist_converge_market_history(input jsonb)
 RETURNS jsonb
 LANGUAGE sql
 PARALLEL UNSAFE
 VOLATILE
BEGIN ATOMIC
 SELECT profile.profile_id
    FROM market_profiles profile
   WHERE (profile.profile_id = ((input ->> 'profileId'::text))::uuid)
  FOR SHARE OF profile;
 SELECT policy.profile_id
    FROM market_intelligence_policies policy
   WHERE (policy.profile_id = ((input ->> 'profileId'::text))::uuid)
  FOR SHARE OF policy;
 INSERT INTO market_history_sources AS source (region_id, type_id, validated_at, fresh_until, source_state, response_count, response_from, response_through, response_digest, last_attempt_at, last_attempt_id)  SELECT target.region_id,
             target.type_id,
             ((input ->> 'validatedAt'::text))::timestamp with time zone AS timestamptz,
             ((input ->> 'freshUntil'::text))::timestamp with time zone AS timestamptz,
                 CASE
                     WHEN (jsonb_array_length((input -> 'days'::text)) = 0) THEN 'empty'::text
                     ELSE 'supplied'::text
                 END AS "case",
             jsonb_array_length((input -> 'days'::text)) AS jsonb_array_length,
             ( SELECT (min((day.value ->> 'date'::text)))::date AS min
                    FROM jsonb_array_elements((input -> 'days'::text)) day(value)) AS min,
             ( SELECT (max((day.value ->> 'date'::text)))::date AS max
                    FROM jsonb_array_elements((input -> 'days'::text)) day(value)) AS max,
             md5(((input -> 'days'::text))::text) AS md5,
             ((input ->> 'attemptedAt'::text))::timestamp with time zone AS timestamptz,
             ((input ->> 'attemptId'::text))::uuid AS uuid
            FROM market_history_eligible_targets target
           WHERE ((target.profile_id = ((input ->> 'profileId'::text))::uuid) AND (target.profile_revision = ((input ->> 'expectedRevision'::text))::bigint) AND (target.region_id = ((input ->> 'regionId'::text))::bigint) AND (target.type_id = ((input ->> 'typeId'::text))::bigint) AND ((((input ->> 'policyRevision'::text) IS NULL) AND target.explicit) OR ((target.policy_revision = ((input ->> 'policyRevision'::text))::bigint) AND (target.universe_id = ((input ->> 'universeId'::text))::uuid)))) ON CONFLICT(region_id, type_id) DO UPDATE SET validated_at = excluded.validated_at, fresh_until = excluded.fresh_until, source_state = excluded.source_state, response_count = excluded.response_count, response_from = excluded.response_from, response_through = excluded.response_through, response_digest = excluded.response_digest, last_attempt_at = GREATEST(source.last_attempt_at, excluded.last_attempt_at), last_failure_class =
         CASE
             WHEN (excluded.last_attempt_at >= source.last_attempt_at) THEN NULL::text
             ELSE source.last_failure_class
         END, last_attempt_id = excluded.last_attempt_id
   WHERE ((source.validated_at < excluded.validated_at) OR ((source.validated_at = excluded.validated_at) AND (source.response_digest = excluded.response_digest)));
 WITH accepted AS MATERIALIZED (
          SELECT source.region_id,
             source.type_id
            FROM market_history_sources source
           WHERE ((source.region_id = ((input ->> 'regionId'::text))::bigint) AND (source.type_id = ((input ->> 'typeId'::text))::bigint) AND (source.last_attempt_id = ((input ->> 'attemptId'::text))::uuid) AND (source.validated_at = ((input ->> 'validatedAt'::text))::timestamp with time zone) AND (source.response_digest = md5(((input -> 'days'::text))::text)) AND (EXISTS ( SELECT 1
                    FROM market_history_eligible_targets target
                   WHERE ((target.profile_id = ((input ->> 'profileId'::text))::uuid) AND (target.profile_revision = ((input ->> 'expectedRevision'::text))::bigint) AND (target.region_id = source.region_id) AND (target.type_id = source.type_id) AND ((((input ->> 'policyRevision'::text) IS NULL) AND target.explicit) OR ((target.policy_revision = ((input ->> 'policyRevision'::text))::bigint) AND (target.universe_id = ((input ->> 'universeId'::text))::uuid)))))))
         ), changed AS (
          INSERT INTO market_daily_history AS history (region_id, type_id, day, average, highest, lowest, volume, order_count, validated_at)  SELECT accepted.region_id,
                     accepted.type_id,
                     record.date,
                     record."averageIsk",
                     record."highIsk",
                     record."lowIsk",
                     record.volume,
                     record."orderCount",
                     ((input ->> 'validatedAt'::text))::timestamp with time zone AS timestamptz
                    FROM (accepted
                      CROSS JOIN jsonb_to_recordset((input -> 'days'::text)) record(date date, "averageIsk" numeric(20,2), "highIsk" numeric(20,2), "lowIsk" numeric(20,2), volume bigint, "orderCount" bigint))
                   WHERE ((record.date >= ((timezone('UTC'::text, now()))::date - 365)) AND (record.date < (timezone('UTC'::text, now()))::date)) ON CONFLICT(region_id, type_id, day) DO UPDATE SET average = excluded.average, highest = excluded.highest, lowest = excluded.lowest, volume = excluded.volume, order_count = excluded.order_count, validated_at = excluded.validated_at
           WHERE ((history.average IS DISTINCT FROM excluded.average) OR (history.highest IS DISTINCT FROM excluded.highest) OR (history.lowest IS DISTINCT FROM excluded.lowest) OR (history.volume IS DISTINCT FROM excluded.volume) OR (history.order_count IS DISTINCT FROM excluded.order_count))
           RETURNING history.day
         ), advanced AS (
          UPDATE market_history_sources source SET content_revision = (source.content_revision +
                 CASE
                     WHEN (EXISTS ( SELECT 1
                        FROM changed)) THEN 1
                     ELSE 0
                 END)
            FROM accepted
           WHERE ((source.region_id = accepted.region_id) AND (source.type_id = accepted.type_id))
           RETURNING source.region_id
         ), progress AS (
          INSERT INTO market_history_collection_state AS state (profile_id, type_id, profile_revision, next_due_at, validated_at, fresh_until, last_attempt_id, attempted_at)  SELECT ((input ->> 'profileId'::text))::uuid AS uuid,
                     accepted.type_id,
                     ((input ->> 'expectedRevision'::text))::bigint AS int8,
                     ((input ->> 'freshUntil'::text))::timestamp with time zone AS timestamptz,
                     ((input ->> 'validatedAt'::text))::timestamp with time zone AS timestamptz,
                     ((input ->> 'freshUntil'::text))::timestamp with time zone AS timestamptz,
                     ((input ->> 'attemptId'::text))::uuid AS uuid,
                     ((input ->> 'attemptedAt'::text))::timestamp with time zone AS timestamptz
                    FROM accepted ON CONFLICT(profile_id, type_id) DO UPDATE SET profile_revision = excluded.profile_revision, next_due_at =
                 CASE
                     WHEN ((state.profile_revision = excluded.profile_revision) AND (state.attempted_at > excluded.attempted_at)) THEN state.next_due_at
                     ELSE excluded.next_due_at
                 END, validated_at = excluded.validated_at, fresh_until = excluded.fresh_until, last_failure_class =
                 CASE
                     WHEN ((state.profile_revision = excluded.profile_revision) AND (state.attempted_at > excluded.attempted_at)) THEN state.last_failure_class
                     ELSE NULL::text
                 END, last_attempt_id = excluded.last_attempt_id, attempted_at = GREATEST(state.attempted_at, excluded.attempted_at)
           RETURNING state.type_id
         )
  SELECT jsonb_build_object('outcome',
         CASE
             WHEN (EXISTS ( SELECT 1
                FROM progress)) THEN 'applied'::text
             WHEN (EXISTS ( SELECT 1
                FROM market_history_eligible_targets target
               WHERE ((target.profile_id = ((input ->> 'profileId'::text))::uuid) AND (target.profile_revision = ((input ->> 'expectedRevision'::text))::bigint) AND (target.type_id = ((input ->> 'typeId'::text))::bigint) AND (target.region_id = ((input ->> 'regionId'::text))::bigint) AND ((((input ->> 'policyRevision'::text) IS NULL) AND target.explicit) OR ((target.policy_revision = ((input ->> 'policyRevision'::text))::bigint) AND (target.universe_id = ((input ->> 'universeId'::text))::uuid)))))) THEN 'superseded'::text
             ELSE 'obsolete'::text
         END, 'changedRows', ( SELECT count(*) AS count
            FROM changed)) AS jsonb_build_object;
END;

create function eve_module_market.persist_read_market_history_source(input jsonb)
 RETURNS jsonb
 LANGUAGE sql
 PARALLEL UNSAFE
 STABLE
BEGIN ATOMIC
 SELECT jsonb_build_object('status',
         CASE
             WHEN (source.validated_at IS NULL) THEN 'uncollected'::text
             ELSE 'observed'::text
         END, 'regionId', profile.region_id, 'typeId', ((input ->> 'typeId'::text))::bigint, 'validatedAt', source.validated_at, 'freshUntil', source.fresh_until, 'source',
         CASE
             WHEN (source.validated_at IS NULL) THEN NULL::jsonb
             ELSE jsonb_build_object('state', source.source_state, 'validatedAt', source.validated_at, 'freshUntil', source.fresh_until, 'contentRevision', (source.content_revision)::text, 'responseCount', source.response_count, 'responseFrom', source.response_from, 'responseThrough', source.response_through, 'lastAttemptAt', source.last_attempt_at, 'lastFailureClass', source.last_failure_class)
         END, 'retainedEvidence', (COALESCE((source.source_state = ANY (ARRAY['empty'::text, 'legacy'::text])), false) AND (EXISTS ( SELECT 1
            FROM market_daily_history history
           WHERE ((history.region_id = profile.region_id) AND (history.type_id = ((input ->> 'typeId'::text))::bigint) AND (history.day >= ((timezone('UTC'::text, now()))::date - 365)) AND (history.day < (timezone('UTC'::text, now()))::date))))), 'days', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('date', history.day, 'averageIsk', (history.average)::text, 'highIsk', (history.highest)::text, 'lowIsk', (history.lowest)::text, 'volume', history.volume, 'orderCount', history.order_count) ORDER BY history.day), '[]'::jsonb) AS "coalesce"
            FROM market_daily_history history
           WHERE ((history.region_id = profile.region_id) AND (history.type_id = ((input ->> 'typeId'::text))::bigint) AND (history.day >= ((timezone('UTC'::text, now()))::date - 365)) AND (history.day < (timezone('UTC'::text, now()))::date)))) AS jsonb_build_object
    FROM (market_profiles profile
      LEFT JOIN market_history_sources source ON (((source.region_id = profile.region_id) AND (source.type_id = ((input ->> 'typeId'::text))::bigint))))
   WHERE ((profile.profile_id = ((input ->> 'profileId'::text))::uuid) AND profile.enabled AND ((profile.mode = 'region'::text) OR (profile.watched_type_ids @> jsonb_build_array(((input ->> 'typeId'::text))::bigint))) AND (((profile.region_id = 19000001) AND (((input ->> 'typeId'::text))::bigint = 44992)) OR ((profile.region_id <> 19000001) AND (((input ->> 'typeId'::text))::bigint <> 44992))));
END;

create function eve_module_market.persist_cleanup_market_history_retention(input jsonb)
 RETURNS jsonb
 LANGUAGE sql
 PARALLEL UNSAFE
 VOLATILE
BEGIN ATOMIC
 WITH expired AS MATERIALIZED (
          SELECT history.region_id,
             history.type_id,
             history.day
            FROM market_daily_history history
           WHERE ((history.day < ((timezone('UTC'::text, ((input ->> 'now'::text))::timestamp with time zone))::date - 365)) OR (history.day >= (timezone('UTC'::text, ((input ->> 'now'::text))::timestamp with time zone))::date))
           ORDER BY history.day, history.region_id, history.type_id
          LIMIT ((input ->> 'limit'::text))::integer
         ), deleted AS (
          DELETE FROM market_daily_history history
            USING expired
           WHERE ((history.region_id = expired.region_id) AND (history.type_id = expired.type_id) AND (history.day = expired.day))
           RETURNING history.day
         )
  SELECT jsonb_build_object('deletedRows', ( SELECT count(*) AS count
            FROM deleted), 'pending', (( SELECT count(*) AS count
            FROM expired) = ((input ->> 'limit'::text))::integer)) AS jsonb_build_object;
END;



create function eve_module_market.persist_list_due_market_history_collection_profiles(input jsonb)
 RETURNS jsonb
 LANGUAGE sql
 PARALLEL UNSAFE
 STABLE
BEGIN ATOMIC
 WITH due AS (
          SELECT target.profile_id,
             target.profile_revision,
             min(COALESCE(state.next_due_at, source.fresh_until, '1970-01-01 00:00:00+00'::timestamp with time zone)) AS next_due_at
            FROM (((market_history_eligible_targets target
              LEFT JOIN market_history_sources source USING (region_id, type_id))
              LEFT JOIN market_history_collection_state state ON (((state.profile_id = target.profile_id) AND (state.type_id = target.type_id) AND (state.profile_revision = target.profile_revision))))
              LEFT JOIN market_history_profile_failures failure ON (((failure.profile_id = target.profile_id) AND (failure.profile_revision = target.profile_revision))))
           WHERE (((source.fresh_until IS NULL) OR (source.fresh_until <= ((input ->> 'now'::text))::timestamp with time zone)) AND ((state.last_failure_class IS NULL) OR (state.next_due_at <= ((input ->> 'now'::text))::timestamp with time zone)) AND ((failure.profile_id IS NULL) OR (failure.next_allowed_at <= ((input ->> 'now'::text))::timestamp with time zone)))
           GROUP BY target.profile_id, target.profile_revision
           ORDER BY (min(COALESCE(state.next_due_at, source.fresh_until, '1970-01-01 00:00:00+00'::timestamp with time zone))), target.profile_id
          LIMIT 16
         )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('profileId', due.profile_id, 'revision', due.profile_revision, 'nextDueAt', due.next_due_at) ORDER BY due.next_due_at, due.profile_id), '[]'::jsonb) AS "coalesce"
    FROM due;
END;

create function eve_module_market.persist_list_due_market_history_targets(input jsonb)
 RETURNS jsonb
 LANGUAGE sql
 PARALLEL UNSAFE
 STABLE
BEGIN ATOMIC
 WITH due AS (
          SELECT target.region_id,
             target.type_id,
                 CASE
                     WHEN target.explicit THEN NULL::bigint
                     ELSE target.policy_revision
                 END AS policy_revision,
                 CASE
                     WHEN target.explicit THEN NULL::uuid
                     ELSE target.universe_id
                 END AS universe_id,
             COALESCE(state.next_due_at, source.fresh_until, '1970-01-01 00:00:00+00'::timestamp with time zone) AS next_due_at
            FROM (((market_history_eligible_targets target
              LEFT JOIN market_history_sources source USING (region_id, type_id))
              LEFT JOIN market_history_collection_state state ON (((state.profile_id = target.profile_id) AND (state.type_id = target.type_id) AND (state.profile_revision = target.profile_revision))))
              LEFT JOIN market_history_profile_failures failure ON (((failure.profile_id = target.profile_id) AND (failure.profile_revision = target.profile_revision))))
           WHERE ((target.profile_id = ((input ->> 'profileId'::text))::uuid) AND (target.profile_revision = ((input ->> 'expectedRevision'::text))::bigint) AND (((input ->> 'typeId'::text) IS NULL) OR (target.type_id = ((input ->> 'typeId'::text))::bigint)) AND ((source.fresh_until IS NULL) OR (source.fresh_until <= ((input ->> 'now'::text))::timestamp with time zone)) AND ((state.last_failure_class IS NULL) OR (state.next_due_at <= ((input ->> 'now'::text))::timestamp with time zone)) AND ((failure.profile_id IS NULL) OR (failure.next_allowed_at <= ((input ->> 'now'::text))::timestamp with time zone)))
           ORDER BY COALESCE(state.next_due_at, source.fresh_until, '1970-01-01 00:00:00+00'::timestamp with time zone), target.type_id
          LIMIT 16
         )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('regionId', due.region_id, 'typeId', due.type_id, 'nextDueAt', due.next_due_at, 'policyRevision', due.policy_revision, 'universeId', due.universe_id) ORDER BY due.next_due_at, due.type_id), '[]'::jsonb) AS "coalesce"
    FROM due;
END;

create function eve_module_market.persist_record_market_history_item_failure(input jsonb)
 RETURNS jsonb
 LANGUAGE sql
 PARALLEL UNSAFE
 VOLATILE
BEGIN ATOMIC
 SELECT profile.profile_id
    FROM market_profiles profile
   WHERE (profile.profile_id = ((input ->> 'profileId'::text))::uuid)
  FOR SHARE OF profile;
 SELECT policy.profile_id
    FROM market_intelligence_policies policy
   WHERE (policy.profile_id = ((input ->> 'profileId'::text))::uuid)
  FOR SHARE OF policy;
 INSERT INTO market_history_collection_state AS state (profile_id, type_id, profile_revision, next_due_at, last_failure_class, last_attempt_id, attempted_at)  SELECT target.profile_id,
             target.type_id,
             target.profile_revision,
             ((input ->> 'retryAt'::text))::timestamp with time zone AS timestamptz,
             (input ->> 'failureClass'::text),
             ((input ->> 'attemptId'::text))::uuid AS uuid,
             ((input ->> 'attemptedAt'::text))::timestamp with time zone AS timestamptz
            FROM market_history_eligible_targets target
           WHERE ((target.profile_id = ((input ->> 'profileId'::text))::uuid) AND (target.profile_revision = ((input ->> 'expectedRevision'::text))::bigint) AND (target.region_id = ((input ->> 'regionId'::text))::bigint) AND (target.type_id = ((input ->> 'typeId'::text))::bigint) AND ((((input ->> 'policyRevision'::text) IS NULL) AND target.explicit) OR ((target.policy_revision = ((input ->> 'policyRevision'::text))::bigint) AND (target.universe_id = ((input ->> 'universeId'::text))::uuid)))) ON CONFLICT(profile_id, type_id) DO UPDATE SET profile_revision = excluded.profile_revision, next_due_at = excluded.next_due_at, last_failure_class = excluded.last_failure_class, last_attempt_id = excluded.last_attempt_id, attempted_at = excluded.attempted_at
   WHERE ((state.profile_revision < excluded.profile_revision) OR ((state.profile_revision = excluded.profile_revision) AND (COALESCE(state.attempted_at, state.validated_at, '1970-01-01 00:00:00+00'::timestamp with time zone) <= excluded.attempted_at)));
 UPDATE market_history_sources source SET last_attempt_at = ((input ->> 'attemptedAt'::text))::timestamp with time zone, last_failure_class = (input ->> 'failureClass'::text)
   WHERE ((source.region_id = ((input ->> 'regionId'::text))::bigint) AND (source.type_id = ((input ->> 'typeId'::text))::bigint) AND (source.last_attempt_at <= ((input ->> 'attemptedAt'::text))::timestamp with time zone) AND (EXISTS ( SELECT 1
            FROM market_history_collection_state state
           WHERE ((state.profile_id = ((input ->> 'profileId'::text))::uuid) AND (state.type_id = source.type_id) AND (state.last_attempt_id = ((input ->> 'attemptId'::text))::uuid)))));
 SELECT jsonb_build_object('outcome',
         CASE
             WHEN (EXISTS ( SELECT 1
                FROM market_history_collection_state state
               WHERE ((state.profile_id = ((input ->> 'profileId'::text))::uuid) AND (state.type_id = ((input ->> 'typeId'::text))::bigint) AND (state.last_attempt_id = ((input ->> 'attemptId'::text))::uuid)))) THEN 'recorded'::text
             ELSE 'obsolete'::text
         END) AS jsonb_build_object;
END;
