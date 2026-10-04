create view market_intelligence_readable_generations as
select generation.*, profile.region_id,
  jsonb_build_object('generationId',generation.generation_id,'profileId',generation.profile_id,
    'profileRevision',generation.profile_revision::text,'policyRevision',generation.policy_revision::text,
    'catalogueRevision',generation.catalogue_revision,'formulaVersion',generation.formula_version,
    'anchorDate',generation.anchor_date,'regionId',profile.region_id,'bookScope',generation.book_scope,
    'historyScope',generation.history_scope,'targetCount',generation.target_count,
    'excludedTypeCount',generation.excluded_type_count,'createdAt',generation.created_at,
    'publishedAt',generation.published_at,'expiresAt',generation.expires_at) as metadata
from market_intelligence_generations as generation
join market_profiles as profile using(profile_id)
join market_intelligence_controls as control using(profile_id)
left join market_intelligence_policies as policy using(profile_id)
where profile.enabled and profile.revision=generation.profile_revision
  and coalesce(policy.revision,0)=generation.policy_revision
  and ((profile.mode='watched-types' and generation.catalogue_revision=control.catalogue_revision) or (policy.enabled and policy.active_universe_id=generation.universe_id))
  and generation.status='complete' and (generation.expires_at is null or generation.expires_at>now())
  and generation.generation_id in(control.current_generation_id,control.prior_generation_id);

create function eve_module_market.persist_read_market_intelligence_generation(input jsonb)
 RETURNS jsonb
 LANGUAGE sql
 PARALLEL UNSAFE
 STABLE
BEGIN ATOMIC
 SELECT jsonb_build_object('generation', generation.metadata, 'cursorSecret', generation.cursor_secret) AS jsonb_build_object
    FROM (market_intelligence_readable_generations generation
      JOIN market_intelligence_controls control USING (profile_id))
   WHERE ((generation.profile_id = ((input ->> 'profileId'::text))::uuid) AND (generation.generation_id = COALESCE(((input ->> 'generationId'::text))::uuid, control.current_generation_id)));
END;

create function eve_module_market.persist_read_market_intelligence_page(input jsonb)
 RETURNS jsonb
 LANGUAGE sql
 PARALLEL UNSAFE
 STABLE
BEGIN ATOMIC
 WITH generation AS MATERIALIZED (
          SELECT market_intelligence_readable_generations.generation_id,
             market_intelligence_readable_generations.cursor_secret,
             market_intelligence_readable_generations.profile_id,
             market_intelligence_readable_generations.profile_revision,
             market_intelligence_readable_generations.policy_revision,
             market_intelligence_readable_generations.universe_id,
             market_intelligence_readable_generations.catalogue_revision,
             market_intelligence_readable_generations.source_identity,
             market_intelligence_readable_generations.dirty_revision,
             market_intelligence_readable_generations.formula_version,
             market_intelligence_readable_generations.anchor_date,
             market_intelligence_readable_generations.book_scope,
             market_intelligence_readable_generations.history_scope,
             market_intelligence_readable_generations.target_count,
             market_intelligence_readable_generations.excluded_type_count,
             market_intelligence_readable_generations.excluded_group_ids,
             market_intelligence_readable_generations.status,
             market_intelligence_readable_generations.cursor_type_id,
             market_intelligence_readable_generations.staged_count,
             market_intelligence_readable_generations.created_at,
             market_intelligence_readable_generations.published_at,
             market_intelligence_readable_generations.expires_at,
             market_intelligence_readable_generations.region_id,
             market_intelligence_readable_generations.metadata
            FROM market_intelligence_readable_generations
           WHERE ((market_intelligence_readable_generations.profile_id = ((input ->> 'profileId'::text))::uuid) AND (market_intelligence_readable_generations.generation_id = ((input ->> 'generationId'::text))::uuid))
         ), filtered AS MATERIALIZED (
          SELECT output.generation_id,
             output.type_id,
             output.group_id,
             output.group_ids,
             output.type_name,
             output.history_source,
             output.book_source,
             output.metrics,
             output.sort_values,
             output.average_daily_value,
             output.average_daily_orders,
             ((output.sort_values ->> (input ->> 'sort'::text)))::numeric AS sort_key
            FROM (market_intelligence_outputs output
              JOIN generation generation_1 USING (generation_id))
           WHERE (((jsonb_array_length((input -> 'typeIds'::text)) = 0) OR (output.type_id IN ( SELECT (jsonb_array_elements_text.value)::bigint AS value
                    FROM jsonb_array_elements_text((input -> 'typeIds'::text)) jsonb_array_elements_text(value)))) AND ((jsonb_array_length((input -> 'groupIds'::text)) = 0) OR (EXISTS ( SELECT 1
                    FROM jsonb_array_elements((input -> 'groupIds'::text)) selector(value)
                   WHERE (output.group_ids @> jsonb_build_array(selector.value))))) AND ((((input ->> 'minimumAverageDailyValueIsk'::text))::numeric = (0)::numeric) OR (output.average_daily_value >= ((input ->> 'minimumAverageDailyValueIsk'::text))::numeric)) AND ((((input ->> 'minimumAverageDailyOrders'::text))::numeric = (0)::numeric) OR (output.average_daily_orders >= ((input ->> 'minimumAverageDailyOrders'::text))::numeric)) AND ((((input ->> 'minimumBaselineDays'::text))::integer = 0) OR ((((output.metrics -> (input ->> 'sort'::text)) ->> 'observedDays'::text))::integer >= ((input ->> 'minimumBaselineDays'::text))::integer)) AND (((input ->> 'includeStale'::text))::boolean OR (((NOT ((input ->> 'needsHistory'::text))::boolean) OR (((output.history_source ->> 'state'::text) = ANY (ARRAY['supplied'::text, 'empty'::text])) AND (((output.history_source ->> 'freshUntil'::text))::timestamp with time zone > now()))) AND ((NOT ((input ->> 'needsBook'::text))::boolean) OR (((output.book_source ->> 'freshUntil'::text))::timestamp with time zone > now())))))
         ), page AS MATERIALIZED (
          SELECT filtered.generation_id,
             filtered.type_id,
             filtered.group_id,
             filtered.group_ids,
             filtered.type_name,
             filtered.history_source,
             filtered.book_source,
             filtered.metrics,
             filtered.sort_values,
             filtered.average_daily_value,
             filtered.average_daily_orders,
             filtered.sort_key
            FROM filtered
           WHERE ((filtered.sort_key IS NOT NULL) AND (((input ->> 'lastKey'::text) IS NULL) OR (((input ->> 'direction'::text) = 'ASC'::text) AND (filtered.sort_key > ((input ->> 'lastKey'::text))::numeric)) OR (((input ->> 'direction'::text) = 'DESC'::text) AND (filtered.sort_key < ((input ->> 'lastKey'::text))::numeric)) OR ((filtered.sort_key = ((input ->> 'lastKey'::text))::numeric) AND (filtered.type_id > ((input ->> 'lastTypeId'::text))::bigint))))
           ORDER BY
                 CASE
                     WHEN ((input ->> 'direction'::text) = 'ASC'::text) THEN filtered.sort_key
                     ELSE NULL::numeric
                 END,
                 CASE
                     WHEN ((input ->> 'direction'::text) = 'DESC'::text) THEN filtered.sort_key
                     ELSE NULL::numeric
                 END DESC, filtered.type_id
          LIMIT (((input ->> 'first'::text))::integer + 1)
         )
  SELECT jsonb_build_object('total', ( SELECT count(*) AS count
            FROM filtered
           WHERE (filtered.sort_key IS NOT NULL)), 'omittedNullSortCount', ( SELECT count(*) AS count
            FROM filtered
           WHERE (filtered.sort_key IS NULL)), 'rows', COALESCE(( SELECT jsonb_agg(jsonb_build_object('sortKey', (page.sort_key)::text, 'row', jsonb_build_object('typeId', page.type_id, 'groupId', page.group_id, 'name', page.type_name, 'historySource', page.history_source, 'bookSource', page.book_source, 'metrics', page.metrics)) ORDER BY
                 CASE
                     WHEN ((input ->> 'direction'::text) = 'ASC'::text) THEN page.sort_key
                     ELSE NULL::numeric
                 END,
                 CASE
                     WHEN ((input ->> 'direction'::text) = 'DESC'::text) THEN page.sort_key
                     ELSE NULL::numeric
                 END DESC, page.type_id) AS jsonb_agg
            FROM page), '[]'::jsonb)) AS jsonb_build_object
    FROM generation;
END;

create function eve_module_market.persist_read_market_intelligence_item(input jsonb)
 RETURNS jsonb
 LANGUAGE sql
 PARALLEL UNSAFE
 STABLE
BEGIN ATOMIC
 SELECT jsonb_build_object('status',
         CASE
             WHEN (excluded.type_id IS NOT NULL) THEN 'ignored'::text
             WHEN (output.type_id IS NULL) THEN 'unavailable'::text
             WHEN (((output.history_source ->> 'state'::text) = 'uncollected'::text) AND (output.book_source IS NULL)) THEN 'uncollected'::text
             ELSE 'observed'::text
         END, 'row',
         CASE
             WHEN (output.type_id IS NULL) THEN NULL::jsonb
             ELSE jsonb_build_object('typeId', output.type_id, 'groupId', output.group_id, 'name', output.type_name, 'historySource', output.history_source, 'bookSource', output.book_source, 'metrics', output.metrics)
         END) AS jsonb_build_object
    FROM ((market_intelligence_readable_generations generation
      LEFT JOIN market_intelligence_outputs output ON (((output.generation_id = generation.generation_id) AND (output.type_id = ((input ->> 'typeId'::text))::bigint))))
      LEFT JOIN market_intelligence_generation_exclusions excluded ON (((excluded.generation_id = generation.generation_id) AND (excluded.type_id = ((input ->> 'typeId'::text))::bigint))))
   WHERE ((generation.profile_id = ((input ->> 'profileId'::text))::uuid) AND (generation.generation_id = ((input ->> 'generationId'::text))::uuid));
END;

create function eve_module_market.persist_read_market_intelligence_history_range(input jsonb)
 RETURNS jsonb
 LANGUAGE sql
 PARALLEL UNSAFE
 STABLE
BEGIN ATOMIC
 WITH profile AS MATERIALIZED (
          SELECT market_profiles.profile_id,
             market_profiles.region_id,
             market_profiles.mode,
             market_profiles.station_ids,
             market_profiles.watched_type_ids,
             market_profiles.enabled,
             market_profiles.revision,
             market_profiles.last_request_id,
             market_profiles.next_due_at,
             market_profiles.last_failure_class,
             market_profiles.last_failure_id,
             market_profiles.updated_at
            FROM market_profiles
           WHERE ((market_profiles.profile_id = ((input ->> 'profileId'::text))::uuid) AND market_profiles.enabled AND ((market_profiles.mode = 'region'::text) OR (market_profiles.watched_type_ids @> jsonb_build_array(((input ->> 'typeId'::text))::bigint))) AND (((market_profiles.region_id = 19000001) AND (((input ->> 'typeId'::text))::bigint = 44992)) OR ((market_profiles.region_id <> 19000001) AND (((input ->> 'typeId'::text))::bigint <> 44992))))
         ), days AS (
          SELECT history.region_id,
             history.type_id,
             history.day,
             history.average,
             history.highest,
             history.lowest,
             history.volume,
             history.order_count,
             history.validated_at
            FROM (market_daily_history history
              JOIN profile profile_1 USING (region_id))
           WHERE ((history.type_id = ((input ->> 'typeId'::text))::bigint) AND ((history.day >= ((input ->> 'from'::text))::date) AND (history.day <= ((input ->> 'through'::text))::date)) AND (history.day >= ((timezone('UTC'::text, now()))::date - 365)) AND (history.day < (timezone('UTC'::text, now()))::date))
           ORDER BY history.day
          LIMIT 365
         )
  SELECT jsonb_build_object('profileId', profile.profile_id, 'profileRevision', (profile.revision)::text, 'regionId', profile.region_id, 'typeId', ((input ->> 'typeId'::text))::bigint, 'from', (input ->> 'from'::text), 'through', (input ->> 'through'::text), 'retainedEvidence', COALESCE(((source.source_state = 'empty'::text) AND (EXISTS ( SELECT 1
            FROM days))), false), 'source',
         CASE
             WHEN (source.type_id IS NULL) THEN NULL::jsonb
             ELSE jsonb_build_object('state', source.source_state, 'validatedAt', source.validated_at, 'freshUntil', source.fresh_until, 'contentRevision', (source.content_revision)::text, 'lastAttemptAt', source.last_attempt_at, 'lastFailureClass', source.last_failure_class)
         END, 'days', COALESCE(( SELECT jsonb_agg(jsonb_build_object('date', days.day, 'averageIsk', (days.average)::text, 'highIsk', (days.highest)::text, 'lowIsk', (days.lowest)::text, 'volume', (days.volume)::text, 'orderCount', (days.order_count)::text) ORDER BY days.day) AS jsonb_agg
            FROM days), '[]'::jsonb)) AS jsonb_build_object
    FROM (profile
      LEFT JOIN market_history_sources source ON (((source.region_id = profile.region_id) AND (source.type_id = ((input ->> 'typeId'::text))::bigint))));
END;

create function eve_module_market.persist_read_market_intelligence_coverage(input jsonb)
 RETURNS jsonb
 LANGUAGE sql
 PARALLEL UNSAFE
 STABLE
BEGIN ATOMIC
 WITH profile AS MATERIALIZED (
          SELECT profile_1.profile_id,
             profile_1.region_id,
             profile_1.mode,
             profile_1.station_ids,
             profile_1.watched_type_ids,
             profile_1.enabled,
             profile_1.revision,
             profile_1.last_request_id,
             profile_1.next_due_at,
             profile_1.last_failure_class,
             profile_1.last_failure_id,
             profile_1.updated_at,
             COALESCE(policy.revision, (0)::bigint) AS policy_revision,
             COALESCE(policy.enabled, false) AS policy_enabled,
             COALESCE(policy.ignored_group_ids, (eve_module_market.persist_read_market_intelligence_policy(input) -> 'ignoredGroupIds'::text)) AS ignored_group_ids,
             universe.universe_id,
             universe.catalogue_revision,
             universe.excluded_type_count,
             universe.activated_at,
             control.current_generation_id
            FROM (((market_profiles profile_1
              LEFT JOIN market_intelligence_policies policy USING (profile_id))
              LEFT JOIN market_intelligence_universes universe ON (((universe.universe_id = policy.active_universe_id) AND (universe.profile_revision = profile_1.revision) AND (universe.policy_revision = policy.revision) AND (universe.status = 'complete'::text))))
              LEFT JOIN market_intelligence_controls control ON ((control.profile_id = profile_1.profile_id)))
           WHERE ((profile_1.profile_id = ((input ->> 'profileId'::text))::uuid) AND profile_1.enabled)
         ), generation AS MATERIALIZED (
          SELECT generation.generation_id,
             generation.cursor_secret,
             generation.profile_id,
             generation.profile_revision,
             generation.policy_revision,
             generation.universe_id,
             generation.catalogue_revision,
             generation.source_identity,
             generation.dirty_revision,
             generation.formula_version,
             generation.anchor_date,
             generation.book_scope,
             generation.history_scope,
             generation.target_count,
             generation.excluded_type_count,
             generation.excluded_group_ids,
             generation.status,
             generation.cursor_type_id,
             generation.staged_count,
             generation.created_at,
             generation.published_at,
             generation.expires_at,
             generation.region_id,
             generation.metadata
            FROM (market_intelligence_readable_generations generation
              JOIN profile profile_1 USING (profile_id))
           WHERE (generation.generation_id = profile_1.current_generation_id)
         ), targets AS MATERIALIZED (
          SELECT target.type_id
            FROM (market_intelligence_targets target
              JOIN profile profile_1 USING (universe_id))
           WHERE ((profile_1.mode = 'region'::text) AND profile_1.policy_enabled)
         UNION
          SELECT (watched.value)::bigint AS value
            FROM (profile profile_1
              CROSS JOIN LATERAL jsonb_array_elements_text(profile_1.watched_type_ids) watched(value))
           WHERE ((profile_1.mode = 'watched-types'::text) AND (NOT (EXISTS ( SELECT 1
                    FROM (market_intelligence_generation_exclusions excluded
                      JOIN generation USING (generation_id))
                   WHERE (excluded.type_id = (watched.value)::bigint)))))
         ), live_rows AS MATERIALIZED (
          SELECT source.validated_at,
             source.fresh_until,
             source.source_state,
             GREATEST(source.last_attempt_at, state.attempted_at) AS attempted_at,
                 CASE
                     WHEN (state.attempted_at > COALESCE(source.last_attempt_at, '1970-01-01 00:00:00+00'::timestamp with time zone)) THEN state.last_failure_class
                     ELSE source.last_failure_class
                 END AS failure_class,
             GREATEST(COALESCE(source.fresh_until, profile_1.activated_at, profile_1.updated_at), state.next_due_at) AS due_at
            FROM (((targets
              CROSS JOIN profile profile_1)
              LEFT JOIN market_history_sources source ON (((source.region_id = profile_1.region_id) AND (source.type_id = targets.type_id))))
              LEFT JOIN market_history_collection_state state ON (((state.profile_id = profile_1.profile_id) AND (state.profile_revision = profile_1.revision) AND (state.type_id = targets.type_id))))
         ), frozen_rows AS MATERIALIZED (
          SELECT ((("row".input_row -> 'historySource'::text) ->> 'validatedAt'::text))::timestamp with time zone AS validated_at,
             ((("row".input_row -> 'historySource'::text) ->> 'freshUntil'::text))::timestamp with time zone AS fresh_until,
             (("row".input_row -> 'historySource'::text) ->> 'state'::text) AS source_state,
             ((("row".input_row -> 'historySource'::text) ->> 'lastAttemptAt'::text))::timestamp with time zone AS attempted_at,
             (("row".input_row -> 'historySource'::text) ->> 'lastFailureClass'::text) AS failure_class,
             COALESCE(((("row".input_row -> 'historySource'::text) ->> 'freshUntil'::text))::timestamp with time zone, generation.created_at) AS due_at,
             generation.created_at AS evaluated_at
            FROM (market_intelligence_inputs "row"
              JOIN generation USING (generation_id))
         ), live AS (
          SELECT jsonb_build_object('eligibleCount', count(*), 'neverAttempted', count(*) FILTER (WHERE ((live_rows.validated_at IS NULL) AND (live_rows.attempted_at IS NULL))), 'freshSuccess', count(*) FILTER (WHERE ((live_rows.validated_at IS NOT NULL) AND (live_rows.fresh_until > now()) AND (live_rows.source_state <> 'legacy'::text))), 'staleSuccess', count(*) FILTER (WHERE ((live_rows.validated_at IS NOT NULL) AND ((live_rows.fresh_until IS NULL) OR (live_rows.fresh_until <= now()) OR (live_rows.source_state = 'legacy'::text)))), 'failedWithoutSuccess', count(*) FILTER (WHERE ((live_rows.validated_at IS NULL) AND (live_rows.attempted_at IS NOT NULL))), 'emptySource', count(*) FILTER (WHERE (live_rows.source_state = 'empty'::text)), 'failedLastAttempt', count(*) FILTER (WHERE (live_rows.failure_class IS NOT NULL)), 'latestAttemptAt', max(live_rows.attempted_at), 'oldestDueAt', min(live_rows.due_at) FILTER (WHERE (live_rows.due_at <= now()))) AS counts
            FROM live_rows
         ), frozen AS (
          SELECT jsonb_build_object('eligibleCount', count(*), 'neverAttempted', count(*) FILTER (WHERE ((frozen_rows.validated_at IS NULL) AND (frozen_rows.attempted_at IS NULL))), 'freshSuccess', count(*) FILTER (WHERE ((frozen_rows.validated_at IS NOT NULL) AND (frozen_rows.fresh_until > frozen_rows.evaluated_at) AND (frozen_rows.source_state <> 'legacy'::text))), 'staleSuccess', count(*) FILTER (WHERE ((frozen_rows.validated_at IS NOT NULL) AND ((frozen_rows.fresh_until IS NULL) OR (frozen_rows.fresh_until <= frozen_rows.evaluated_at) OR (frozen_rows.source_state = 'legacy'::text)))), 'failedWithoutSuccess', count(*) FILTER (WHERE ((frozen_rows.validated_at IS NULL) AND (frozen_rows.attempted_at IS NOT NULL))), 'emptySource', count(*) FILTER (WHERE (frozen_rows.source_state = 'empty'::text)), 'failedLastAttempt', count(*) FILTER (WHERE (frozen_rows.failure_class IS NOT NULL)), 'latestAttemptAt', max(frozen_rows.attempted_at), 'oldestDueAt', min(frozen_rows.due_at) FILTER (WHERE (frozen_rows.due_at <= frozen_rows.evaluated_at))) AS counts
            FROM frozen_rows
         )
  SELECT jsonb_build_object('profileId', profile.profile_id, 'profileRevision', (profile.revision)::text, 'regionId', profile.region_id, 'historyScope',
         CASE
             WHEN (profile.region_id = 19000001) THEN 'global-plex'::text
             ELSE 'region'::text
         END, 'bookScope',
         CASE
             WHEN (profile.region_id = 19000001) THEN 'global-plex'::text
             WHEN (jsonb_array_length(profile.station_ids) > 0) THEN 'stations'::text
             ELSE 'region'::text
         END, 'policyRevision', (profile.policy_revision)::text, 'policyEnabled', profile.policy_enabled, 'ignoredGroupIds', profile.ignored_group_ids, 'catalogueRevision', COALESCE(profile.catalogue_revision, ( SELECT generation.catalogue_revision
            FROM generation)), 'excludedTypeCount', COALESCE(profile.excluded_type_count, ( SELECT generation.excluded_type_count
            FROM generation)), 'evaluatedAt', now(), 'live', ( SELECT live.counts
            FROM live), 'generation', ( SELECT jsonb_build_object('generation', generation.metadata, 'evaluatedAt', generation.created_at, 'counts', ( SELECT frozen.counts
                    FROM frozen)) AS jsonb_build_object
            FROM generation)) AS jsonb_build_object
    FROM profile;
END;
