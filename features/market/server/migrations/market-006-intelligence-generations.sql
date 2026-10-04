create table market_intelligence_controls (
  profile_id uuid primary key references market_profiles(profile_id) on delete cascade,
  source_identity text,
  dirty_revision bigint not null default 0,
  published_revision bigint not null default 0,
  last_started_at timestamptz,
  catalogue_revision jsonb,
  catalogue_checked_at timestamptz,
  last_work_kind text check(last_work_kind in ('reconciliation','history','derivation')),
  staging_generation_id uuid,
  current_generation_id uuid,
  prior_generation_id uuid
);
create table market_intelligence_generations (
  generation_id uuid primary key,
  cursor_secret uuid not null,
  profile_id uuid not null references market_profiles(profile_id) on delete cascade,
  profile_revision bigint not null,
  policy_revision bigint not null,
  universe_id uuid,
  catalogue_revision jsonb not null,
  source_identity text not null,
  dirty_revision bigint not null,
  formula_version integer not null check(formula_version = 1),
  anchor_date date not null,
  book_scope text not null check(book_scope in ('region','stations','global-plex')),
  history_scope text not null check(history_scope in ('region','global-plex')),
  target_count integer not null check(target_count between 0 and 32000),
  excluded_type_count integer not null check(excluded_type_count between 0 and 32000),
  excluded_group_ids jsonb not null,
  status text not null check(status in ('staging','complete','retired')),
  cursor_type_id bigint not null default 0,
  staged_count integer not null default 0 check(staged_count between 0 and 32000),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  expires_at timestamptz
);
create unique index market_intelligence_one_report_stage_idx on market_intelligence_generations(profile_id) where status='staging';
create index market_intelligence_report_retention_idx on market_intelligence_generations(expires_at,created_at);
create table market_intelligence_generation_exclusions (
  generation_id uuid not null references market_intelligence_generations(generation_id) on delete cascade,
  type_id bigint not null,
  primary key(generation_id,type_id)
);
create table market_intelligence_inputs (
  generation_id uuid not null references market_intelligence_generations(generation_id) on delete cascade,
  type_id bigint not null,
  input_row jsonb not null,
  primary key(generation_id,type_id)
);
create table market_intelligence_outputs (
  generation_id uuid not null references market_intelligence_generations(generation_id) on delete cascade,
  type_id bigint not null,
  group_id bigint not null,
  group_ids jsonb not null,
  type_name text not null,
  history_source jsonb not null,
  book_source jsonb,
  metrics jsonb not null,
  sort_values jsonb not null,
  average_daily_value numeric,
  average_daily_orders numeric,
  primary key(generation_id,type_id)
);
create index market_intelligence_output_activity_idx on market_intelligence_outputs(generation_id,average_daily_value,average_daily_orders,type_id);
create index market_intelligence_output_groups_idx on market_intelligence_outputs using gin(group_ids);

create view market_intelligence_profile_sources as
select profile.profile_id, profile.revision as profile_revision, profile.region_id,
  profile.mode, profile.station_ids, profile.watched_type_ids,
  coalesce(policy.revision,0) as policy_revision, case when profile.mode='region' then policy.active_universe_id else null end as universe_id,
  case when profile.mode='region' then universe.catalogue_revision else null end as catalogue_revision,
  universe.target_count, case when profile.mode='region' then universe.excluded_type_count else null end as excluded_type_count, case when profile.mode='region' then universe.excluded_group_ids else null end as excluded_group_ids,
  md5(jsonb_build_object('profile',profile.revision,'policy',coalesce(policy.revision,0),
    'universe',policy.active_universe_id,'watchedCatalogue',control.catalogue_revision,'anchor',timezone('UTC',now())::date - 1,
    'sources',coalesce(sources.identities,'[]'::jsonb),'books',coalesce(books.identities,'[]'::jsonb))::text) as source_identity
from market_profiles as profile
left join market_intelligence_controls as control using(profile_id)
left join market_intelligence_policies as policy using(profile_id)
left join market_intelligence_universes as universe on universe.universe_id=policy.active_universe_id
left join lateral (
  select jsonb_agg(jsonb_build_array(target.type_id,source.validated_at,source.fresh_until,
    source.source_state,source.content_revision,source.last_attempt_at,source.last_failure_class,
    state.attempted_at,state.last_failure_class) order by target.type_id) as identities
  from market_history_eligible_targets as target
  left join market_history_sources as source using(region_id,type_id)
  left join market_history_collection_state as state on state.profile_id=target.profile_id
    and state.type_id=target.type_id and state.profile_revision=profile.revision
  where target.profile_id=profile.profile_id
) as sources on true
left join lateral (
  select jsonb_agg(jsonb_build_array(observation.observation_id,observation.latest_validated_at,observation.fresh_until) order by observation.observation_id) as identities
  from market_current_observations as pointer
  join market_observations as observation using(observation_id)
  where observation.profile_id=profile.profile_id and observation.profile_revision=profile.revision
    and observation.status='complete'
) as books on true
where profile.enabled and (profile.mode='watched-types' or (policy.enabled
  and universe.status='complete' and universe.profile_revision=profile.revision and universe.policy_revision=policy.revision));

create function eve_module_market.persist_list_due_market_intelligence_derivations(input jsonb)
 RETURNS jsonb
 LANGUAGE sql
 PARALLEL UNSAFE
 STABLE
BEGIN ATOMIC
 SELECT COALESCE(jsonb_agg(jsonb_build_object('profileId', candidate.profile_id, 'revision', candidate.profile_revision, 'nextDueAt',
         CASE
             WHEN (control.staging_generation_id IS NOT NULL) THEN control.last_started_at
             WHEN ((candidate.mode = 'watched-types'::text) AND ((control.catalogue_checked_at IS NULL) OR ((control.catalogue_checked_at + '00:01:00'::interval) <= ((input ->> 'now'::text))::timestamp with time zone))) THEN COALESCE((control.catalogue_checked_at + '00:01:00'::interval), '1970-01-01 00:00:00+00'::timestamp with time zone)
             ELSE COALESCE((control.last_started_at + '00:05:00'::interval), '1970-01-01 00:00:00+00'::timestamp with time zone)
         END) ORDER BY candidate.profile_id), '[]'::jsonb) AS "coalesce"
    FROM (market_intelligence_profile_sources candidate
      LEFT JOIN market_intelligence_controls control USING (profile_id))
   WHERE ((control.staging_generation_id IS NOT NULL) OR ((candidate.mode = 'watched-types'::text) AND ((control.catalogue_checked_at IS NULL) OR ((control.catalogue_checked_at + '00:01:00'::interval) <= ((input ->> 'now'::text))::timestamp with time zone))) OR (((control.source_identity IS DISTINCT FROM candidate.source_identity) OR (control.dirty_revision > control.published_revision) OR (control.current_generation_id IS NULL)) AND ((control.last_started_at IS NULL) OR ((control.last_started_at + '00:05:00'::interval) <= ((input ->> 'now'::text))::timestamp with time zone))));
END;

create function eve_module_market.persist_select_market_intelligence_work(input jsonb)
 RETURNS jsonb
 LANGUAGE sql
 PARALLEL UNSAFE
 VOLATILE
BEGIN ATOMIC
 SELECT profile.profile_id
    FROM market_profiles profile
   WHERE (profile.profile_id = ((input ->> 'profileId'::text))::uuid)
  FOR SHARE OF profile;
 INSERT INTO market_intelligence_controls AS control (profile_id, source_identity, dirty_revision)  SELECT profile.profile_id,
             source.source_identity,
                 CASE
                     WHEN (source.source_identity IS NULL) THEN 0
                     ELSE 1
                 END AS "case"
            FROM (market_profiles profile
              LEFT JOIN market_intelligence_profile_sources source USING (profile_id))
           WHERE ((profile.profile_id = ((input ->> 'profileId'::text))::uuid) AND profile.enabled AND (profile.revision = ((input ->> 'profileRevision'::text))::bigint)) ON CONFLICT(profile_id) DO UPDATE SET source_identity = excluded.source_identity, dirty_revision = (control.dirty_revision +
         CASE
             WHEN (control.source_identity IS DISTINCT FROM excluded.source_identity) THEN 1
             ELSE 0
         END);
 WITH chosen AS (
          SELECT control.profile_id,
             work.kind
            FROM ((market_intelligence_controls control
              JOIN market_profiles profile USING (profile_id))
              CROSS JOIN LATERAL ( SELECT available.kind
                    FROM ( VALUES ('reconciliation'::text,0,((input ->> 'reconciliationDue'::text))::boolean), ('history'::text,1,((input ->> 'historyDue'::text))::boolean), ('derivation'::text,2,((EXISTS ( SELECT 1
                                    FROM market_intelligence_profile_sources source
                                   WHERE (source.profile_id = profile.profile_id))) AND ((control.staging_generation_id IS NOT NULL) OR ((profile.mode = 'watched-types'::text) AND ((control.catalogue_checked_at IS NULL) OR ((control.catalogue_checked_at + '00:01:00'::interval) <= now()))) OR (((control.dirty_revision > control.published_revision) OR (control.current_generation_id IS NULL)) AND ((control.last_started_at IS NULL) OR ((control.last_started_at + '00:05:00'::interval) <= now()))))))) available(kind, ordinal, due)
                   WHERE available.due
                   ORDER BY (((available.ordinal - COALESCE((array_position(ARRAY['reconciliation'::text, 'history'::text, 'derivation'::text], control.last_work_kind) - 1), '-1'::integer)) + 2) % 3)
                  LIMIT 1) work)
           WHERE ((profile.profile_id = ((input ->> 'profileId'::text))::uuid) AND (profile.revision = ((input ->> 'profileRevision'::text))::bigint) AND profile.enabled)
         ), advanced AS (
          UPDATE market_intelligence_controls control SET last_work_kind = chosen.kind
            FROM chosen
           WHERE (control.profile_id = chosen.profile_id)
           RETURNING chosen.kind
         )
  SELECT jsonb_build_object('kind', ( SELECT advanced.kind
            FROM advanced)) AS jsonb_build_object;
END;

create function eve_module_market.persist_begin_market_intelligence_generation(input jsonb)
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
             control.dirty_revision
            FROM (market_intelligence_profile_sources source
              JOIN market_intelligence_controls control USING (profile_id))
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
          INSERT INTO market_intelligence_inputs (generation_id, type_id, input_row)  SELECT generation.generation_id,
                     target.type_id,
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

create function eve_module_market.persist_read_market_intelligence_input_page(input jsonb)
 RETURNS jsonb
 LANGUAGE sql
 PARALLEL UNSAFE
 STABLE
BEGIN ATOMIC
 WITH generation AS MATERIALIZED (
          SELECT generation_1.generation_id,
             generation_1.profile_id,
             generation_1.profile_revision,
             generation_1.policy_revision,
             generation_1.universe_id,
             generation_1.catalogue_revision,
             generation_1.source_identity,
             generation_1.dirty_revision,
             generation_1.formula_version,
             generation_1.anchor_date,
             generation_1.book_scope,
             generation_1.history_scope,
             generation_1.target_count,
             generation_1.excluded_type_count,
             generation_1.excluded_group_ids,
             generation_1.status,
             generation_1.cursor_type_id,
             generation_1.staged_count,
             generation_1.created_at,
             generation_1.published_at,
             generation_1.expires_at
            FROM ((market_intelligence_generations generation_1
              JOIN market_intelligence_controls control ON ((control.staging_generation_id = generation_1.generation_id)))
              JOIN market_intelligence_profile_sources source ON (((source.profile_id = generation_1.profile_id) AND (source.profile_revision = generation_1.profile_revision) AND (source.policy_revision = generation_1.policy_revision) AND (NOT (source.universe_id IS DISTINCT FROM generation_1.universe_id)) AND ((source.mode <> 'watched-types'::text) OR (generation_1.catalogue_revision = control.catalogue_revision)))))
           WHERE ((generation_1.profile_id = ((input ->> 'profileId'::text))::uuid) AND (generation_1.profile_revision = ((input ->> 'profileRevision'::text))::bigint) AND (generation_1.status = 'staging'::text) AND (generation_1.created_at > (now() - '24:00:00'::interval)))
         ), page AS (
          SELECT "row".input_row
            FROM (market_intelligence_inputs "row"
              JOIN generation generation_1 USING (generation_id))
           WHERE ("row".type_id > generation_1.cursor_type_id)
           ORDER BY "row".type_id
          LIMIT 100
         )
  SELECT jsonb_build_object('generationId', generation.generation_id, 'cursorTypeId', generation.cursor_type_id, 'rows', COALESCE(( SELECT jsonb_agg(page.input_row ORDER BY ((page.input_row ->> 'typeId'::text))::bigint) AS jsonb_agg
            FROM page), '[]'::jsonb)) AS jsonb_build_object
    FROM generation;
END;

create function eve_module_market.persist_stage_market_intelligence_outputs(input jsonb)
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
 WITH eligible AS MATERIALIZED (
          SELECT generation.generation_id,
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
             generation.expires_at
            FROM ((market_intelligence_generations generation
              JOIN market_intelligence_controls control ON ((control.staging_generation_id = generation.generation_id)))
              JOIN market_intelligence_profile_sources source ON (((source.profile_id = generation.profile_id) AND (source.profile_revision = generation.profile_revision) AND (source.policy_revision = generation.policy_revision) AND (NOT (source.universe_id IS DISTINCT FROM generation.universe_id)) AND ((source.mode <> 'watched-types'::text) OR (generation.catalogue_revision = control.catalogue_revision)))))
           WHERE ((generation.generation_id = ((input ->> 'generationId'::text))::uuid) AND (generation.profile_id = ((input ->> 'profileId'::text))::uuid) AND (generation.profile_revision = ((input ->> 'profileRevision'::text))::bigint) AND (generation.status = 'staging'::text) AND (generation.created_at > (now() - '24:00:00'::interval)) AND (generation.cursor_type_id = ((input ->> 'cursorTypeId'::text))::bigint))
         ), proposed AS MATERIALIZED (
          SELECT "row"."typeId" AS type_id,
             "row".metrics
            FROM jsonb_to_recordset((input -> 'rows'::text)) "row"("typeId" bigint, metrics jsonb)
         ), expected AS MATERIALIZED (
          SELECT "row".generation_id,
             "row".type_id,
             "row".input_row
            FROM (market_intelligence_inputs "row"
              JOIN eligible USING (generation_id))
           WHERE ("row".type_id > eligible.cursor_type_id)
           ORDER BY "row".type_id
          LIMIT 100
         ), valid AS MATERIALIZED (
          SELECT eligible.generation_id,
             eligible.profile_id,
             eligible.profile_revision,
             eligible.policy_revision,
             eligible.universe_id,
             eligible.catalogue_revision,
             eligible.source_identity,
             eligible.dirty_revision,
             eligible.formula_version,
             eligible.anchor_date,
             eligible.book_scope,
             eligible.history_scope,
             eligible.target_count,
             eligible.excluded_type_count,
             eligible.excluded_group_ids,
             eligible.status,
             eligible.cursor_type_id,
             eligible.staged_count,
             eligible.created_at,
             eligible.published_at,
             eligible.expires_at
            FROM eligible
           WHERE ((( SELECT count(*) AS count
                    FROM proposed) = ( SELECT count(*) AS count
                    FROM expected)) AND (NOT (EXISTS ( SELECT 1
                    FROM (expected
                      FULL JOIN proposed USING (type_id))
                   WHERE ((expected.type_id IS NULL) OR (proposed.type_id IS NULL))))))
         ), staged AS (
          INSERT INTO market_intelligence_outputs (generation_id, type_id, group_id, group_ids, type_name, history_source, book_source, metrics, sort_values, average_daily_value, average_daily_orders)  SELECT valid.generation_id,
                     expected.type_id,
                     ((expected.input_row ->> 'groupId'::text))::bigint AS int8,
                     (expected.input_row -> 'groupIds'::text),
                     (expected.input_row ->> 'name'::text),
                     (expected.input_row -> 'historySource'::text),
                     NULLIF((expected.input_row -> 'bookSource'::text), 'null'::jsonb) AS "nullif",
                     proposed.metrics,
                     ( SELECT jsonb_object_agg(metric.key,
                                 CASE
                                     WHEN (((metric.value ->> 'denominator'::text))::numeric > (0)::numeric) THEN (((metric.value ->> 'numerator'::text))::numeric / ((metric.value ->> 'denominator'::text))::numeric)
                                     ELSE NULL::numeric
                                 END) AS jsonb_object_agg
                            FROM jsonb_each(proposed.metrics) metric(key, value)) AS jsonb_object_agg,
                     ((((proposed.metrics -> 'averageDailyValueIsk'::text) ->> 'numerator'::text))::numeric / NULLIF((((proposed.metrics -> 'averageDailyValueIsk'::text) ->> 'denominator'::text))::numeric, (0)::numeric)),
                     ((((proposed.metrics -> 'averageDailyOrders'::text) ->> 'numerator'::text))::numeric / NULLIF((((proposed.metrics -> 'averageDailyOrders'::text) ->> 'denominator'::text))::numeric, (0)::numeric))
                    FROM ((valid
                      JOIN expected ON (true))
                      JOIN proposed USING (type_id))
           RETURNING market_intelligence_outputs.type_id
         ), advanced AS (
          UPDATE market_intelligence_generations generation SET cursor_type_id = COALESCE(( SELECT max(staged.type_id) AS max
                    FROM staged), generation.cursor_type_id), staged_count = (generation.staged_count + ( SELECT count(*) AS count
                    FROM staged))
            FROM valid
           WHERE (generation.generation_id = valid.generation_id)
           RETURNING generation.generation_id
         )
  SELECT jsonb_build_object('outcome',
         CASE
             WHEN (EXISTS ( SELECT 1
                FROM advanced)) THEN 'staged'::text
             ELSE 'obsolete'::text
         END) AS jsonb_build_object;
END;

create function eve_module_market.persist_publish_market_intelligence_generation(input jsonb)
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
 WITH eligible AS MATERIALIZED (
          SELECT generation.generation_id,
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
             control.current_generation_id,
             control.prior_generation_id,
             source.source_identity AS latest_identity
            FROM ((market_intelligence_generations generation
              JOIN market_intelligence_controls control ON ((control.staging_generation_id = generation.generation_id)))
              JOIN market_intelligence_profile_sources source ON (((source.profile_id = generation.profile_id) AND (source.profile_revision = generation.profile_revision) AND (source.policy_revision = generation.policy_revision) AND (NOT (source.universe_id IS DISTINCT FROM generation.universe_id)) AND ((source.mode <> 'watched-types'::text) OR (generation.catalogue_revision = control.catalogue_revision)))))
           WHERE ((generation.generation_id = ((input ->> 'generationId'::text))::uuid) AND (generation.profile_id = ((input ->> 'profileId'::text))::uuid) AND (generation.profile_revision = ((input ->> 'profileRevision'::text))::bigint) AND (generation.status = 'staging'::text) AND (generation.created_at > (now() - '24:00:00'::interval)) AND (generation.staged_count = generation.target_count) AND (( SELECT count(*) AS count
                    FROM market_intelligence_outputs output
                   WHERE (output.generation_id = generation.generation_id)) = generation.target_count))
         ), retired AS (
          DELETE FROM market_intelligence_generations generation
            USING eligible
           WHERE (generation.generation_id = eligible.prior_generation_id)
           RETURNING generation.generation_id
         ), prior AS (
          UPDATE market_intelligence_generations generation SET expires_at = (now() + '24:00:00'::interval)
            FROM eligible
           WHERE (generation.generation_id = eligible.current_generation_id)
           RETURNING generation.generation_id
         ), published AS (
          UPDATE market_intelligence_generations generation SET status = 'complete'::text, published_at = now()
            FROM eligible
           WHERE (generation.generation_id = eligible.generation_id)
           RETURNING generation.generation_id
         ), advanced AS (
          UPDATE market_intelligence_controls control SET prior_generation_id = control.current_generation_id, current_generation_id = eligible.generation_id, staging_generation_id = NULL::uuid, published_revision = eligible.dirty_revision, dirty_revision = (control.dirty_revision +
                 CASE
                     WHEN (control.source_identity IS DISTINCT FROM eligible.latest_identity) THEN 1
                     ELSE 0
                 END), source_identity = eligible.latest_identity
            FROM (eligible
              JOIN published USING (generation_id))
           WHERE (control.profile_id = eligible.profile_id)
           RETURNING control.profile_id
         )
  SELECT jsonb_build_object('outcome',
         CASE
             WHEN (EXISTS ( SELECT 1
                FROM advanced)) THEN 'published'::text
             ELSE 'obsolete'::text
         END) AS jsonb_build_object;
END;

create function eve_module_market.persist_cleanup_market_intelligence_generations(input jsonb)
 RETURNS jsonb
 LANGUAGE sql
 PARALLEL UNSAFE
 VOLATILE
BEGIN ATOMIC
 WITH expired AS MATERIALIZED (
          SELECT generation.generation_id,
             generation.profile_id
            FROM (market_intelligence_generations generation
              LEFT JOIN market_intelligence_controls control ON ((control.current_generation_id = generation.generation_id)))
           WHERE ((control.profile_id IS NULL) AND ((generation.expires_at <= ((input ->> 'now'::text))::timestamp with time zone) OR ((generation.status = 'staging'::text) AND (generation.created_at <= (((input ->> 'now'::text))::timestamp with time zone - '24:00:00'::interval)))))
           ORDER BY generation.created_at, generation.generation_id
          LIMIT 1
         ), cleared AS (
          UPDATE market_intelligence_controls control SET staging_generation_id =
                 CASE
                     WHEN (control.staging_generation_id = expired.generation_id) THEN NULL::uuid
                     ELSE control.staging_generation_id
                 END, prior_generation_id =
                 CASE
                     WHEN (control.prior_generation_id = expired.generation_id) THEN NULL::uuid
                     ELSE control.prior_generation_id
                 END
            FROM expired
           WHERE (control.profile_id = expired.profile_id)
           RETURNING control.profile_id
         ), removed AS (
          DELETE FROM market_intelligence_generations generation
            USING expired
           WHERE (generation.generation_id = expired.generation_id)
           RETURNING generation.generation_id
         )
  SELECT jsonb_build_object('removed', ( SELECT count(*) AS count
            FROM removed)) AS jsonb_build_object;
END;

create function eve_module_market.persist_record_market_intelligence_catalogue(input jsonb)
 RETURNS jsonb
 LANGUAGE sql
 PARALLEL UNSAFE
 VOLATILE
BEGIN ATOMIC
 SELECT profile.profile_id
    FROM market_profiles profile
   WHERE (profile.profile_id = ((input ->> 'profileId'::text))::uuid)
  FOR SHARE OF profile;
 WITH recorded AS (
          UPDATE market_intelligence_controls control SET catalogue_revision = (input -> 'catalogueRevision'::text), catalogue_checked_at = now(), dirty_revision = (control.dirty_revision +
                 CASE
                     WHEN (control.catalogue_revision IS DISTINCT FROM (input -> 'catalogueRevision'::text)) THEN 1
                     ELSE 0
                 END)
            FROM market_profiles profile
           WHERE ((profile.profile_id = control.profile_id) AND profile.enabled AND (profile.mode = 'watched-types'::text) AND (profile.profile_id = ((input ->> 'profileId'::text))::uuid) AND (profile.revision = ((input ->> 'profileRevision'::text))::bigint))
           RETURNING control.profile_id
         )
  SELECT jsonb_build_object('outcome',
         CASE
             WHEN (EXISTS ( SELECT 1
                FROM recorded)) THEN 'recorded'::text
             ELSE 'obsolete'::text
         END) AS jsonb_build_object;
END;
