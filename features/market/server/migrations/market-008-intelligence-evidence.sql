-- Older generations cannot recover historical retry deadlines from mutable collection state.
alter table market_intelligence_inputs add column effective_due_at timestamptz;

create function eve_module_market.persist_begin_market_intelligence_generation_snapshot(input jsonb)
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
 SELECT control.profile_id
    FROM market_intelligence_controls control
   WHERE (control.profile_id = ((input ->> 'profileId'::text))::uuid)
  FOR UPDATE OF control;
 UPDATE market_intelligence_controls control SET staging_generation_id = NULL::uuid
    FROM market_intelligence_generations generation
   WHERE ((control.profile_id = ((input ->> 'profileId'::text))::uuid) AND (generation.generation_id = control.staging_generation_id) AND ((generation.profile_revision <> ((input ->> 'profileRevision'::text))::bigint) OR (generation.policy_revision <> ((input ->> 'policyRevision'::text))::bigint) OR (generation.universe_id IS DISTINCT FROM ((input ->> 'universeId'::text))::uuid) OR ((generation.universe_id IS NULL) AND (generation.catalogue_revision IS DISTINCT FROM (input -> 'catalogueRevision'::text))) OR (generation.created_at <= (now() - '24:00:00'::interval))) AND (EXISTS ( SELECT 1
            FROM market_intelligence_profile_sources source
           WHERE ((source.profile_id = control.profile_id) AND (source.profile_revision = ((input ->> 'profileRevision'::text))::bigint) AND (source.policy_revision = ((input ->> 'policyRevision'::text))::bigint) AND (NOT (source.universe_id IS DISTINCT FROM ((input ->> 'universeId'::text))::uuid)) AND ((source.mode <> 'watched-types'::text) OR (control.catalogue_revision = (input -> 'catalogueRevision'::text)))))));
 DELETE FROM market_intelligence_generations generation
    USING market_intelligence_controls control
   WHERE ((generation.profile_id = ((input ->> 'profileId'::text))::uuid) AND (control.profile_id = generation.profile_id) AND (generation.status = 'staging'::text) AND (generation.generation_id IS DISTINCT FROM control.staging_generation_id));
 WITH eligible AS MATERIALIZED (
          SELECT source.profile_id,
             source.profile_revision,
             source.region_id,
             source.mode,
             source.station_ids,
             source.watched_type_ids,
             source.policy_revision,
             source.universe_id,
             source.catalogue_revision,
             source.target_count,
             source.excluded_type_count,
             source.excluded_group_ids,
             source.source_identity,
             control.dirty_revision,
             profile.updated_at,
             universe.activated_at
            FROM (((market_intelligence_profile_sources source
              JOIN market_intelligence_controls control USING (profile_id))
              JOIN market_profiles profile USING (profile_id))
              LEFT JOIN market_intelligence_universes universe ON ((universe.universe_id = source.universe_id)))
           WHERE ((source.profile_id = ((input ->> 'profileId'::text))::uuid) AND (source.profile_revision = ((input ->> 'profileRevision'::text))::bigint) AND (source.policy_revision = ((input ->> 'policyRevision'::text))::bigint) AND (NOT (source.universe_id IS DISTINCT FROM ((input ->> 'universeId'::text))::uuid)) AND (control.staging_generation_id IS NULL) AND ((control.last_started_at IS NULL) OR ((control.last_started_at + '00:05:00'::interval) <= now())) AND ((source.mode = 'region'::text) OR (((input -> 'catalogueRevision'::text) = control.catalogue_revision) AND (jsonb_array_length((input -> 'watchedTargets'::text)) <= 16))))
         ), targets AS MATERIALIZED (
          SELECT target.type_id,
             target.group_id,
             target.type_name,
             target.group_ids
            FROM (eligible
              JOIN market_intelligence_targets target ON ((target.universe_id = eligible.universe_id)))
           WHERE (eligible.mode = 'region'::text)
         UNION ALL
          SELECT target."typeId",
             target."groupId",
             target.name,
             target."groupIds"
            FROM (eligible
              CROSS JOIN jsonb_to_recordset((input -> 'watchedTargets'::text)) target("typeId" bigint, "groupId" bigint, name text, "groupIds" jsonb))
           WHERE ((eligible.mode = 'watched-types'::text) AND (eligible.watched_type_ids @> jsonb_build_array(target."typeId")))
         ), started AS (
          INSERT INTO market_intelligence_generations (generation_id, cursor_secret, profile_id, profile_revision, policy_revision, universe_id, catalogue_revision, source_identity, dirty_revision, formula_version, anchor_date, book_scope, history_scope, target_count, excluded_type_count, excluded_group_ids, status)  SELECT ((input ->> 'generationId'::text))::uuid AS uuid,
                     ((input ->> 'cursorSecret'::text))::uuid AS uuid,
                     eligible.profile_id,
                     eligible.profile_revision,
                     eligible.policy_revision,
                     eligible.universe_id,
                     COALESCE(eligible.catalogue_revision, (input -> 'catalogueRevision'::text)) AS "coalesce",
                     eligible.source_identity,
                     eligible.dirty_revision,
                     1,
                     ((timezone('UTC'::text, now()))::date - 1),
                         CASE
                             WHEN (eligible.region_id = 19000001) THEN 'global-plex'::text
                             WHEN (jsonb_array_length(eligible.station_ids) > 0) THEN 'stations'::text
                             ELSE 'region'::text
                         END AS "case",
                         CASE
                             WHEN (eligible.region_id = 19000001) THEN 'global-plex'::text
                             ELSE 'region'::text
                         END AS "case",
                     ( SELECT count(*) AS count
                            FROM targets) AS count,
                     COALESCE(eligible.excluded_type_count, ((input ->> 'excludedTypeCount'::text))::integer) AS "coalesce",
                     COALESCE(eligible.excluded_group_ids, (input -> 'excludedGroupIds'::text)) AS "coalesce",
                     'staging'
                    FROM eligible
           RETURNING market_intelligence_generations.generation_id,
             market_intelligence_generations.profile_id,
             market_intelligence_generations.profile_revision,
             market_intelligence_generations.policy_revision,
             market_intelligence_generations.universe_id,
             market_intelligence_generations.catalogue_revision,
             market_intelligence_generations.source_identity,
             market_intelligence_generations.dirty_revision,
             market_intelligence_generations.formula_version,
             market_intelligence_generations.anchor_date,
             market_intelligence_generations.book_scope,
             market_intelligence_generations.history_scope,
             market_intelligence_generations.target_count,
             market_intelligence_generations.excluded_type_count,
             market_intelligence_generations.excluded_group_ids,
             market_intelligence_generations.status,
             market_intelligence_generations.cursor_type_id,
             market_intelligence_generations.staged_count,
             market_intelligence_generations.created_at,
             market_intelligence_generations.published_at,
             market_intelligence_generations.expires_at
         ), history AS MATERIALIZED (
          SELECT day.type_id,
             jsonb_build_array(jsonb_build_object('windowDays', 7, 'observedDays', count(*) FILTER (WHERE (day.day >= (generation.anchor_date - 6))), 'volume', (COALESCE(sum(day.volume) FILTER (WHERE (day.day >= (generation.anchor_date - 6))), (0)::numeric))::text, 'orderCount', (COALESCE(sum(day.order_count) FILTER (WHERE (day.day >= (generation.anchor_date - 6))), (0)::numeric))::text, 'estimatedValueCents', ((COALESCE(sum(((day.average * (100)::numeric) * (day.volume)::numeric)) FILTER (WHERE (day.day >= (generation.anchor_date - 6))), (0)::numeric))::numeric(80,0))::text), jsonb_build_object('windowDays', 30, 'observedDays', count(*) FILTER (WHERE (day.day >= (generation.anchor_date - 29))), 'volume', (COALESCE(sum(day.volume) FILTER (WHERE (day.day >= (generation.anchor_date - 29))), (0)::numeric))::text, 'orderCount', (COALESCE(sum(day.order_count) FILTER (WHERE (day.day >= (generation.anchor_date - 29))), (0)::numeric))::text, 'estimatedValueCents', ((COALESCE(sum(((day.average * (100)::numeric) * (day.volume)::numeric)) FILTER (WHERE (day.day >= (generation.anchor_date - 29))), (0)::numeric))::numeric(80,0))::text), jsonb_build_object('windowDays', 365, 'observedDays', count(*), 'volume', (sum(day.volume))::text, 'orderCount', (sum(day.order_count))::text, 'estimatedValueCents', ((sum(((day.average * (100)::numeric) * (day.volume)::numeric)))::numeric(80,0))::text)) AS windows,
                 CASE
                     WHEN (count(*) FILTER (WHERE (day.day = generation.anchor_date)) > 0) THEN jsonb_build_object('averageIsk', (max(day.average) FILTER (WHERE (day.day = generation.anchor_date)))::text, 'volume', (max(day.volume) FILTER (WHERE (day.day = generation.anchor_date)))::text)
                     ELSE NULL::jsonb
                 END AS anchor
            FROM (((started generation
              JOIN eligible ON (true))
              JOIN targets ON (true))
              JOIN market_daily_history day ON (((day.region_id = eligible.region_id) AND (day.type_id = targets.type_id) AND ((day.day >= (generation.anchor_date - 364)) AND (day.day <= generation.anchor_date)))))
           GROUP BY day.type_id
         ), books AS MATERIALIZED (
          SELECT observation.observation_id,
             observation.profile_id,
             observation.profile_revision,
             observation.market_key,
             observation.region_id,
             observation.type_id,
             observation.expected_pages,
             observation.status,
             observation.started_at,
             observation.observed_at,
             observation.earliest_validated_at,
             observation.latest_validated_at,
             observation.fresh_until,
             observation.published_at,
             observation.order_count
            FROM ((eligible
              JOIN market_observations observation ON (((observation.profile_id = eligible.profile_id) AND (observation.profile_revision = eligible.profile_revision) AND (observation.status = 'complete'::text))))
              JOIN market_current_observations pointer USING (observation_id))
         ), orders AS MATERIALIZED (
          SELECT market_order.type_id,
             market_order.side,
             market_order.price,
             market_order.volume_remain,
             min(market_order.price) FILTER (WHERE (market_order.side = 'sell'::text)) OVER (PARTITION BY market_order.type_id) AS best_ask,
             max(market_order.price) FILTER (WHERE (market_order.side = 'buy'::text)) OVER (PARTITION BY market_order.type_id) AS best_bid
            FROM ((books
              JOIN market_observation_orders market_order USING (observation_id))
              JOIN eligible ON (true))
           WHERE (((books.type_id IS NULL) OR (market_order.type_id = books.type_id)) AND (market_order.volume_remain > 0) AND ((market_order.issued_at + ((market_order.duration_days)::double precision * '1 day'::interval)) > now()) AND ((jsonb_array_length(eligible.station_ids) = 0) OR (eligible.station_ids @> jsonb_build_array(market_order.location_id))))
         ), depth AS MATERIALIZED (
          SELECT orders.type_id,
             max(orders.best_ask) AS best_ask,
             max(orders.best_bid) AS best_bid,
             (COALESCE(sum(orders.volume_remain) FILTER (WHERE (orders.side = 'sell'::text)), (0)::numeric))::text AS sell_depth,
             (COALESCE(sum(orders.volume_remain) FILTER (WHERE ((orders.side = 'sell'::text) AND (orders.price <= (orders.best_ask * 1.05)))), (0)::numeric))::text AS sell_depth_5,
             (COALESCE(sum(orders.volume_remain) FILTER (WHERE ((orders.side = 'sell'::text) AND (orders.price <= (orders.best_ask * 1.10)))), (0)::numeric))::text AS sell_depth_10
            FROM orders
           GROUP BY orders.type_id
         ), exclusions AS (
          INSERT INTO market_intelligence_generation_exclusions (generation_id, type_id)  SELECT generation.generation_id,
                     excluded.type_id
                    FROM ((started generation
                      JOIN eligible ON (true))
                      JOIN market_intelligence_excluded_targets excluded ON ((excluded.universe_id = eligible.universe_id)))
                   WHERE (eligible.mode = 'region'::text)
                 UNION ALL
                  SELECT generation.generation_id,
                     (type.value)::bigint AS value
                    FROM ((started generation
                      JOIN eligible ON (true))
                      CROSS JOIN jsonb_array_elements_text((input -> 'ignoredTypeIds'::text)) type(value))
                   WHERE ((eligible.mode = 'watched-types'::text) AND (eligible.watched_type_ids @> jsonb_build_array((type.value)::bigint)))
           RETURNING market_intelligence_generation_exclusions.type_id
         ), frozen AS (
          INSERT INTO market_intelligence_inputs (generation_id, type_id, effective_due_at, input_row)  SELECT generation.generation_id,
                     target.type_id,
                     GREATEST(COALESCE(source.fresh_until, eligible.activated_at, eligible.updated_at), state.next_due_at) AS "greatest",
                     jsonb_build_object('typeId', target.type_id, 'groupId', target.group_id, 'name', target.type_name, 'groupIds', target.group_ids, 'historySource', jsonb_build_object('state', COALESCE(source.source_state, 'uncollected'::text), 'validatedAt', source.validated_at, 'freshUntil', source.fresh_until, 'contentRevision', (COALESCE(source.content_revision, (0)::bigint))::text, 'lastAttemptAt', GREATEST(source.last_attempt_at, state.attempted_at), 'lastFailureClass',
                         CASE
                             WHEN (state.attempted_at > COALESCE(source.last_attempt_at, '1970-01-01 00:00:00+00'::timestamp with time zone)) THEN state.last_failure_class
                             ELSE source.last_failure_class
                         END), 'bookSource',
                         CASE
                             WHEN (book.observation_id IS NULL) THEN NULL::jsonb
                             ELSE jsonb_build_object('observationId', book.observation_id, 'observedAt', book.observed_at, 'validatedAt', book.latest_validated_at, 'freshUntil', book.fresh_until)
                         END, 'metricsInput', jsonb_build_object('sourceState', COALESCE(source.source_state, 'uncollected'::text), 'windows', COALESCE(history.windows, '[{"volume": "0", "orderCount": "0", "windowDays": 7, "observedDays": 0, "estimatedValueCents": "0"}, {"volume": "0", "orderCount": "0", "windowDays": 30, "observedDays": 0, "estimatedValueCents": "0"}, {"volume": "0", "orderCount": "0", "windowDays": 365, "observedDays": 0, "estimatedValueCents": "0"}]'::jsonb), 'anchor', history.anchor, 'book',
                         CASE
                             WHEN (book.observation_id IS NULL) THEN NULL::jsonb
                             ELSE jsonb_build_object('bestBidIsk', (depth.best_bid)::text, 'bestAskIsk', (depth.best_ask)::text, 'sellDepth', COALESCE(depth.sell_depth, '0'::text), 'sellDepth5Percent',
                             CASE
                                 WHEN (depth.best_ask IS NULL) THEN NULL::text
                                 ELSE depth.sell_depth_5
                             END, 'sellDepth10Percent',
                             CASE
                                 WHEN (depth.best_ask IS NULL) THEN NULL::text
                                 ELSE depth.sell_depth_10
                             END)
                         END)) AS jsonb_build_object
                    FROM (((((((started generation
                      JOIN eligible ON (true))
                      JOIN targets target ON (true))
                      LEFT JOIN history ON ((history.type_id = target.type_id)))
                      LEFT JOIN depth ON ((depth.type_id = target.type_id)))
                      LEFT JOIN books book ON (((book.type_id IS NULL) OR (book.type_id = target.type_id))))
                      LEFT JOIN market_history_sources source ON (((source.region_id = eligible.region_id) AND (source.type_id = target.type_id))))
                      LEFT JOIN market_history_collection_state state ON (((state.profile_id = eligible.profile_id) AND (state.profile_revision = eligible.profile_revision) AND (state.type_id = target.type_id))))
           RETURNING market_intelligence_inputs.type_id
         ), advanced AS (
          UPDATE market_intelligence_controls control SET staging_generation_id = generation.generation_id, last_started_at = generation.created_at
            FROM started generation
           WHERE ((control.profile_id = generation.profile_id) AND (( SELECT count(*) AS count
                    FROM frozen) = generation.target_count))
           RETURNING generation.generation_id
         )
  SELECT jsonb_build_object('outcome',
         CASE
             WHEN (EXISTS ( SELECT 1
                FROM advanced)) THEN 'started'::text
             ELSE 'deferred'::text
         END) AS jsonb_build_object;
END;

create function eve_module_market.persist_read_market_intelligence_history_range_retained(input jsonb)
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
  SELECT jsonb_build_object('profileId', profile.profile_id, 'profileRevision', (profile.revision)::text, 'regionId', profile.region_id, 'typeId', ((input ->> 'typeId'::text))::bigint, 'from', (input ->> 'from'::text), 'through', (input ->> 'through'::text), 'retainedEvidence', COALESCE(((source.source_state = ANY (ARRAY['empty'::text, 'legacy'::text])) AND (EXISTS ( SELECT 1
            FROM days))), false), 'source',
         CASE
             WHEN (source.type_id IS NULL) THEN NULL::jsonb
             ELSE jsonb_build_object('state', source.source_state, 'validatedAt', source.validated_at, 'freshUntil', source.fresh_until, 'contentRevision', (source.content_revision)::text, 'lastAttemptAt', source.last_attempt_at, 'lastFailureClass', source.last_failure_class)
         END, 'days', COALESCE(( SELECT jsonb_agg(jsonb_build_object('date', days.day, 'averageIsk', (days.average)::text, 'highIsk', (days.highest)::text, 'lowIsk', (days.lowest)::text, 'volume', (days.volume)::text, 'orderCount', (days.order_count)::text) ORDER BY days.day) AS jsonb_agg
            FROM days), '[]'::jsonb)) AS jsonb_build_object
    FROM (profile
      LEFT JOIN market_history_sources source ON (((source.region_id = profile.region_id) AND (source.type_id = ((input ->> 'typeId'::text))::bigint))));
END;

create function eve_module_market.persist_read_market_intelligence_coverage_snapshot(input jsonb)
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
             COALESCE(policy.ignored_group_ids, (persist_read_market_intelligence_policy(input) -> 'ignoredGroupIds'::text)) AS ignored_group_ids,
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
             "row".effective_due_at AS due_at,
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
