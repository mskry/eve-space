create table market_intelligence_policies (
  profile_id uuid primary key references market_profiles (profile_id) on delete cascade,
  enabled boolean not null default false,
  revision bigint not null check (revision > 0),
  ignored_group_ids jsonb not null check (jsonb_typeof(ignored_group_ids) = 'array' and jsonb_array_length(ignored_group_ids) <= 256),
  catalogue_revision jsonb not null,
  last_request_id uuid not null,
  active_universe_id uuid,
  next_reconcile_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table market_intelligence_universes (
  universe_id uuid primary key,
  profile_id uuid not null references market_profiles (profile_id) on delete cascade,
  profile_revision bigint not null,
  policy_revision bigint not null,
  catalogue_revision jsonb not null,
  target_count integer not null check (target_count between 0 and 32000),
  excluded_type_count integer not null check (excluded_type_count between 0 and 32000),
  excluded_group_ids jsonb not null check (jsonb_array_length(excluded_group_ids) <= 4000),
  status text not null check (status in ('staging', 'complete')),
  started_at timestamptz not null default now(),
  activated_at timestamptz,
  unique (profile_id, universe_id)
);
create unique index market_intelligence_one_stage_idx on market_intelligence_universes (profile_id) where status = 'staging';

create table market_intelligence_targets (
  universe_id uuid not null references market_intelligence_universes (universe_id) on delete cascade,
  type_id bigint not null check (type_id > 0),
  group_id bigint not null check (group_id > 0),
  type_name text not null check (length(type_name) between 1 and 500),
  group_ids jsonb not null check (jsonb_array_length(group_ids) between 1 and 4000),
  primary key (universe_id, type_id)
);

create table market_intelligence_excluded_targets (
  universe_id uuid not null references market_intelligence_universes(universe_id) on delete cascade,
  type_id bigint not null,
  group_id bigint not null,
  type_name text not null,
  group_ids jsonb not null,
  primary key(universe_id,type_id)
);

create function eve_module_market.persist_read_market_intelligence_policy(input jsonb)
 RETURNS jsonb
 LANGUAGE sql
 PARALLEL UNSAFE
 STABLE
BEGIN ATOMIC
 SELECT jsonb_build_object('enabled', COALESCE(policy.enabled, false), 'revision', COALESCE(policy.revision, (0)::bigint), 'ignoredGroupIds', COALESCE(policy.ignored_group_ids, '[150, 1954, 3630, 204, 209, 1041, 1338, 2157, 2158, 1663, 20, 22, 23, 2801, 1846, 492, 614, 751, 754, 1109, 2480, 1396]'::jsonb), 'catalogueRevision', policy.catalogue_revision) AS jsonb_build_object
    FROM (market_profiles profile
      LEFT JOIN market_intelligence_policies policy USING (profile_id))
   WHERE (profile.profile_id = ((input ->> 'profileId'::text))::uuid);
END;


create function eve_module_market.persist_save_market_intelligence_policy(input jsonb)
 RETURNS jsonb
 LANGUAGE sql
 PARALLEL UNSAFE
 VOLATILE
BEGIN ATOMIC
 SELECT profile.profile_id
    FROM market_profiles profile
   WHERE (profile.profile_id = ((input ->> 'profileId'::text))::uuid)
  FOR UPDATE OF profile;
 WITH eligible AS MATERIALIZED (
          SELECT profile.profile_id
            FROM (market_profiles profile
              LEFT JOIN market_intelligence_policies policy USING (profile_id))
           WHERE ((profile.profile_id = ((input ->> 'profileId'::text))::uuid) AND (profile.revision = ((input ->> 'profileRevision'::text))::bigint) AND ((COALESCE(policy.revision, (0)::bigint) = ((input ->> 'expectedPolicyRevision'::text))::bigint) OR (policy.last_request_id = ((input ->> 'requestId'::text))::uuid)) AND ((NOT ((input ->> 'enabled'::text))::boolean) OR (profile.enabled AND (profile.mode = 'region'::text) AND (profile.region_id <> 19000001))))
         ), saved AS (
          INSERT INTO market_intelligence_policies AS policy (profile_id, enabled, revision, ignored_group_ids, catalogue_revision, last_request_id)  SELECT eligible.profile_id,
                     ((input ->> 'enabled'::text))::boolean AS bool,
                     1,
                     (input -> 'ignoredGroupIds'::text),
                     (input -> 'catalogueRevision'::text),
                     ((input ->> 'requestId'::text))::uuid AS uuid
                    FROM eligible ON CONFLICT(profile_id) DO UPDATE SET enabled = excluded.enabled, revision = (policy.revision + 1), ignored_group_ids = excluded.ignored_group_ids, catalogue_revision = excluded.catalogue_revision, last_request_id = excluded.last_request_id, active_universe_id = NULL::uuid, next_reconcile_at = now(), updated_at = now()
           WHERE (policy.last_request_id <> excluded.last_request_id)
           RETURNING policy.revision
         )
  SELECT COALESCE(( SELECT jsonb_build_object('outcome', 'saved', 'revision', saved.revision) AS jsonb_build_object
            FROM saved), ( SELECT jsonb_build_object('outcome', 'saved', 'revision', policy.revision) AS jsonb_build_object
            FROM (market_intelligence_policies policy
              JOIN eligible USING (profile_id))
           WHERE (policy.last_request_id = ((input ->> 'requestId'::text))::uuid)), jsonb_build_object('outcome', 'obsolete')) AS "coalesce";
END;


create function eve_module_market.persist_read_market_intelligence_universe(input jsonb)
 RETURNS jsonb
 LANGUAGE sql
 PARALLEL UNSAFE
 STABLE
BEGIN ATOMIC
 WITH eligible AS MATERIALIZED (
          SELECT policy.active_universe_id,
             profile.profile_id
            FROM (market_profiles profile
              JOIN market_intelligence_policies policy USING (profile_id))
           WHERE ((profile.profile_id = ((input ->> 'profileId'::text))::uuid) AND profile.enabled AND policy.enabled AND (profile.mode = 'region'::text) AND (profile.region_id <> 19000001) AND (profile.revision = ((input ->> 'profileRevision'::text))::bigint) AND (policy.revision = ((input ->> 'policyRevision'::text))::bigint))
         ), universes AS MATERIALIZED (
          SELECT universe.universe_id,
             universe.status,
             jsonb_build_object('universeId', universe.universe_id, 'profileRevision', universe.profile_revision, 'policyRevision', universe.policy_revision, 'catalogueRevision', universe.catalogue_revision, 'targetCount', universe.target_count, 'excludedTypeCount', universe.excluded_type_count, 'excludedGroupIds', universe.excluded_group_ids, 'status', universe.status, 'stagedCount', ( SELECT count(*) AS count
                    FROM market_intelligence_targets target
                   WHERE (target.universe_id = universe.universe_id))) AS value
            FROM (market_intelligence_universes universe
              JOIN eligible eligible_1 USING (profile_id))
           WHERE ((universe.profile_revision = ((input ->> 'profileRevision'::text))::bigint) AND (universe.policy_revision = ((input ->> 'policyRevision'::text))::bigint))
         )
  SELECT jsonb_build_object('active', ( SELECT universes.value
            FROM universes
           WHERE (universes.universe_id = eligible.active_universe_id)), 'staging', ( SELECT universes.value
            FROM universes
           WHERE (universes.status = 'staging'::text))) AS jsonb_build_object
    FROM eligible;
END;


create function eve_module_market.persist_begin_market_intelligence_universe(input jsonb)
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
  FOR UPDATE OF policy;
 DELETE FROM market_intelligence_universes universe
    USING market_profiles profile,
     market_intelligence_policies policy
   WHERE ((universe.profile_id = ((input ->> 'profileId'::text))::uuid) AND (profile.profile_id = universe.profile_id) AND (policy.profile_id = universe.profile_id) AND (profile.revision = ((input ->> 'profileRevision'::text))::bigint) AND (policy.revision = ((input ->> 'policyRevision'::text))::bigint) AND (universe.status = 'staging'::text) AND ((universe.profile_revision <> profile.revision) OR (universe.policy_revision <> policy.revision) OR (universe.started_at < (now() - '24:00:00'::interval)) OR (universe.catalogue_revision <> (input -> 'catalogueRevision'::text))));
 WITH eligible AS MATERIALIZED (
          SELECT profile.profile_id
            FROM (market_profiles profile
              JOIN market_intelligence_policies policy USING (profile_id))
           WHERE ((profile.profile_id = ((input ->> 'profileId'::text))::uuid) AND profile.enabled AND policy.enabled AND (profile.mode = 'region'::text) AND (profile.region_id <> 19000001) AND (profile.revision = ((input ->> 'profileRevision'::text))::bigint) AND (policy.revision = ((input ->> 'policyRevision'::text))::bigint))
         ), started AS (
          INSERT INTO market_intelligence_universes (universe_id, profile_id, profile_revision, policy_revision, catalogue_revision, target_count, excluded_type_count, excluded_group_ids, status)  SELECT ((input ->> 'universeId'::text))::uuid AS uuid,
                     eligible.profile_id,
                     ((input ->> 'profileRevision'::text))::bigint AS int8,
                     ((input ->> 'policyRevision'::text))::bigint AS int8,
                     (input -> 'catalogueRevision'::text),
                     ((input ->> 'targetCount'::text))::integer AS int4,
                     ((input ->> 'excludedTypeCount'::text))::integer AS int4,
                     (input -> 'excludedGroupIds'::text),
                     'staging'
                    FROM eligible ON CONFLICT DO NOTHING
           RETURNING market_intelligence_universes.universe_id
         )
  SELECT jsonb_build_object('outcome',
         CASE
             WHEN (EXISTS ( SELECT 1
                FROM started)) THEN 'started'::text
             WHEN (NOT (EXISTS ( SELECT 1
                FROM eligible))) THEN 'obsolete'::text
             WHEN (EXISTS ( SELECT 1
                FROM market_intelligence_universes
               WHERE ((market_intelligence_universes.universe_id = ((input ->> 'universeId'::text))::uuid) AND (market_intelligence_universes.status = 'staging'::text) AND (market_intelligence_universes.profile_id = ((input ->> 'profileId'::text))::uuid) AND (market_intelligence_universes.profile_revision = ((input ->> 'profileRevision'::text))::bigint) AND (market_intelligence_universes.policy_revision = ((input ->> 'policyRevision'::text))::bigint) AND (market_intelligence_universes.catalogue_revision = (input -> 'catalogueRevision'::text)) AND (market_intelligence_universes.target_count = ((input ->> 'targetCount'::text))::integer) AND (market_intelligence_universes.excluded_type_count = ((input ->> 'excludedTypeCount'::text))::integer) AND (market_intelligence_universes.excluded_group_ids = (input -> 'excludedGroupIds'::text))))) THEN 'started'::text
             ELSE 'busy'::text
         END) AS jsonb_build_object;
END;


create function eve_module_market.persist_stage_market_intelligence_targets(input jsonb)
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
 SELECT universe.universe_id
    FROM market_intelligence_universes universe
   WHERE (universe.universe_id = ((input ->> 'universeId'::text))::uuid)
  FOR UPDATE OF universe;
 WITH incoming AS MATERIALIZED (
          SELECT "row"."typeId",
             "row"."groupId",
             "row".name,
             "row"."groupIds"
            FROM jsonb_to_recordset((input -> 'targets'::text)) "row"("typeId" bigint, "groupId" bigint, name text, "groupIds" jsonb)
         ), eligible AS MATERIALIZED (
          SELECT universe.universe_id,
             universe.target_count
            FROM ((market_intelligence_universes universe
              JOIN market_profiles profile USING (profile_id))
              JOIN market_intelligence_policies policy USING (profile_id))
           WHERE ((universe.universe_id = ((input ->> 'universeId'::text))::uuid) AND (universe.profile_id = ((input ->> 'profileId'::text))::uuid) AND (universe.status = 'staging'::text) AND profile.enabled AND policy.enabled AND (profile.mode = 'region'::text) AND (profile.region_id <> 19000001) AND (profile.revision = universe.profile_revision) AND (policy.revision = universe.policy_revision) AND (profile.revision = ((input ->> 'profileRevision'::text))::bigint) AND (policy.revision = ((input ->> 'policyRevision'::text))::bigint))
         ), consistent AS MATERIALIZED (
          SELECT eligible.universe_id
            FROM eligible
           WHERE ((( SELECT count(*) AS count
                    FROM incoming) >= 1) AND (( SELECT count(*) AS count
                    FROM incoming) <= 1000) AND (( SELECT count(DISTINCT incoming."typeId") AS count
                    FROM incoming) = ( SELECT count(*) AS count
                    FROM incoming)) AND ((( SELECT count(*) AS count
                    FROM market_intelligence_targets target
                   WHERE (target.universe_id = eligible.universe_id)) + ( SELECT count(*) AS count
                    FROM incoming
                   WHERE (NOT (EXISTS ( SELECT 1
                            FROM market_intelligence_targets target
                           WHERE ((target.universe_id = eligible.universe_id) AND (target.type_id = incoming."typeId"))))))) <= eligible.target_count) AND (NOT (EXISTS ( SELECT 1
                    FROM (incoming
                      JOIN market_intelligence_targets target ON (((target.universe_id = eligible.universe_id) AND (target.type_id = incoming."typeId"))))
                   WHERE ((target.group_id IS DISTINCT FROM incoming."groupId") OR (target.type_name IS DISTINCT FROM incoming.name) OR (target.group_ids IS DISTINCT FROM incoming."groupIds"))))) AND (NOT (EXISTS ( SELECT 1
                    FROM (incoming
                      JOIN market_profiles profile ON ((profile.profile_id = ((input ->> 'profileId'::text))::uuid)))
                   WHERE ((incoming."typeId" = 44992) <> (profile.region_id = 19000001))))))
         ), staged AS (
          INSERT INTO market_intelligence_targets (universe_id, type_id, group_id, type_name, group_ids)  SELECT consistent.universe_id,
                     incoming."typeId",
                     incoming."groupId",
                     incoming.name,
                     incoming."groupIds"
                    FROM (consistent
                      CROSS JOIN incoming) ON CONFLICT DO NOTHING
           RETURNING market_intelligence_targets.type_id
         )
  SELECT jsonb_build_object('outcome',
         CASE
             WHEN (EXISTS ( SELECT 1
                FROM consistent)) THEN 'staged'::text
             WHEN (EXISTS ( SELECT 1
                FROM eligible)) THEN 'inconsistent'::text
             ELSE 'obsolete'::text
         END) AS jsonb_build_object;
END;


create function eve_module_market.persist_activate_market_intelligence_universe(input jsonb)
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
  FOR UPDATE OF policy;
 SELECT universe.universe_id
    FROM market_intelligence_universes universe
   WHERE (universe.universe_id = ((input ->> 'universeId'::text))::uuid)
  FOR UPDATE OF universe;
 WITH eligible AS MATERIALIZED (
          SELECT universe.universe_id,
             universe.target_count,
             universe.excluded_type_count
            FROM ((market_intelligence_universes universe
              JOIN market_profiles profile USING (profile_id))
              JOIN market_intelligence_policies policy USING (profile_id))
           WHERE ((universe.universe_id = ((input ->> 'universeId'::text))::uuid) AND (universe.profile_id = ((input ->> 'profileId'::text))::uuid) AND profile.enabled AND policy.enabled AND (profile.mode = 'region'::text) AND (profile.region_id <> 19000001) AND (profile.revision = universe.profile_revision) AND (policy.revision = universe.policy_revision) AND (profile.revision = ((input ->> 'profileRevision'::text))::bigint) AND (policy.revision = ((input ->> 'policyRevision'::text))::bigint))
         ), completed AS (
          UPDATE market_intelligence_universes universe SET status = 'complete'::text, activated_at = COALESCE(universe.activated_at, now())
            FROM eligible
           WHERE ((universe.universe_id = eligible.universe_id) AND (( SELECT count(*) AS count
                    FROM market_intelligence_targets target
                   WHERE (target.universe_id = eligible.universe_id)) = eligible.target_count) AND (( SELECT count(*) AS count
                    FROM market_intelligence_excluded_targets target
                   WHERE (target.universe_id = eligible.universe_id)) = eligible.excluded_type_count))
           RETURNING universe.universe_id
         ), activated AS (
          UPDATE market_intelligence_policies policy SET active_universe_id = completed.universe_id, next_reconcile_at = (now() + '00:01:00'::interval)
            FROM completed
           WHERE (policy.profile_id = ((input ->> 'profileId'::text))::uuid)
           RETURNING policy.profile_id
         ), pruned AS (
          DELETE FROM market_intelligence_universes universe
            USING activated
           WHERE ((universe.profile_id = activated.profile_id) AND (universe.status = 'complete'::text) AND (universe.universe_id <> ((input ->> 'universeId'::text))::uuid))
           RETURNING universe.universe_id
         )
  SELECT jsonb_build_object('outcome',
         CASE
             WHEN (EXISTS ( SELECT 1
                FROM activated)) THEN 'activated'::text
             WHEN (EXISTS ( SELECT 1
                FROM eligible)) THEN 'incomplete'::text
             ELSE 'obsolete'::text
         END) AS jsonb_build_object;
END;


create function eve_module_market.persist_list_due_market_intelligence_reconciliations(input jsonb)
 RETURNS jsonb
 LANGUAGE sql
 PARALLEL UNSAFE
 STABLE
BEGIN ATOMIC
 SELECT COALESCE(jsonb_agg(jsonb_build_object('profileId', due.profile_id, 'revision', due.revision, 'nextDueAt', due.next_reconcile_at) ORDER BY due.next_reconcile_at, due.profile_id), '[]'::jsonb) AS "coalesce"
    FROM ( SELECT profile.profile_id,
             profile.revision,
             policy.next_reconcile_at
            FROM (market_profiles profile
              JOIN market_intelligence_policies policy USING (profile_id))
           WHERE (profile.enabled AND (profile.mode = 'region'::text) AND (profile.region_id <> 19000001) AND policy.enabled AND (policy.next_reconcile_at <= ((input ->> 'now'::text))::timestamp with time zone))
           ORDER BY policy.next_reconcile_at, profile.profile_id
          LIMIT 4) due;
END;

create function eve_module_market.persist_record_market_intelligence_reconciliation(input jsonb)
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
          UPDATE market_intelligence_policies policy SET next_reconcile_at = (now() + '00:01:00'::interval)
            FROM market_profiles profile,
             market_intelligence_universes universe
           WHERE ((policy.profile_id = profile.profile_id) AND (universe.universe_id = policy.active_universe_id) AND (profile.profile_id = ((input ->> 'profileId'::text))::uuid) AND profile.enabled AND policy.enabled AND (profile.revision = ((input ->> 'profileRevision'::text))::bigint) AND (policy.revision = ((input ->> 'policyRevision'::text))::bigint) AND (universe.universe_id = ((input ->> 'universeId'::text))::uuid) AND (universe.profile_revision = profile.revision) AND (universe.policy_revision = policy.revision) AND (universe.catalogue_revision = (input -> 'catalogueRevision'::text)))
           RETURNING policy.profile_id
         )
  SELECT
         CASE
             WHEN (EXISTS ( SELECT 1
                FROM recorded)) THEN jsonb_build_object('outcome'::text, 'recorded'::text)
             ELSE jsonb_build_object('outcome'::text, 'obsolete'::text)
         END AS outcome;
END;
create function eve_module_market.persist_stage_market_intelligence_exclusions(input jsonb)
 RETURNS jsonb
 LANGUAGE sql
 PARALLEL UNSAFE
 VOLATILE
BEGIN ATOMIC
 SELECT universe.universe_id
    FROM market_intelligence_universes universe
   WHERE (universe.universe_id = ((input ->> 'universeId'::text))::uuid)
  FOR UPDATE OF universe;
 WITH eligible AS MATERIALIZED (
          SELECT universe.universe_id,
             universe.profile_id,
             universe.profile_revision,
             universe.policy_revision,
             universe.catalogue_revision,
             universe.target_count,
             universe.excluded_type_count,
             universe.excluded_group_ids,
             universe.status,
             universe.started_at,
             universe.activated_at
            FROM ((market_intelligence_universes universe
              JOIN market_profiles profile USING (profile_id))
              JOIN market_intelligence_policies policy USING (profile_id))
           WHERE ((universe.universe_id = ((input ->> 'universeId'::text))::uuid) AND (universe.profile_id = ((input ->> 'profileId'::text))::uuid) AND (universe.status = 'staging'::text) AND profile.enabled AND policy.enabled AND (profile.revision = ((input ->> 'profileRevision'::text))::bigint) AND (policy.revision = ((input ->> 'policyRevision'::text))::bigint) AND (universe.profile_revision = profile.revision) AND (universe.policy_revision = policy.revision))
         ), incoming AS MATERIALIZED (
          SELECT "row"."typeId",
             "row"."groupId",
             "row".name,
             "row"."groupIds"
            FROM jsonb_to_recordset((input -> 'targets'::text)) "row"("typeId" bigint, "groupId" bigint, name text, "groupIds" jsonb)
         ), valid AS MATERIALIZED (
          SELECT eligible.universe_id
            FROM eligible
           WHERE ((( SELECT count(*) AS count
                    FROM incoming) >= 1) AND (( SELECT count(*) AS count
                    FROM incoming) <= 1000) AND (( SELECT count(*) AS count
                    FROM incoming) = ( SELECT count(DISTINCT incoming."typeId") AS count
                    FROM incoming)) AND ((( SELECT count(*) AS count
                    FROM market_intelligence_excluded_targets target
                   WHERE (target.universe_id = eligible.universe_id)) + ( SELECT count(*) AS count
                    FROM incoming
                   WHERE (NOT (EXISTS ( SELECT 1
                            FROM market_intelligence_excluded_targets target
                           WHERE ((target.universe_id = eligible.universe_id) AND (target.type_id = incoming."typeId"))))))) <= eligible.excluded_type_count) AND (NOT (EXISTS ( SELECT 1
                    FROM (incoming
                      JOIN market_intelligence_excluded_targets target ON (((target.universe_id = eligible.universe_id) AND (target.type_id = incoming."typeId"))))
                   WHERE ((target.group_id IS DISTINCT FROM incoming."groupId") OR (target.type_name IS DISTINCT FROM incoming.name) OR (target.group_ids IS DISTINCT FROM incoming."groupIds"))))) AND (NOT (EXISTS ( SELECT 1
                    FROM (incoming
                      JOIN market_intelligence_targets target ON (((target.universe_id = eligible.universe_id) AND (target.type_id = incoming."typeId"))))))))
         ), staged AS (
          INSERT INTO market_intelligence_excluded_targets (universe_id, type_id, group_id, type_name, group_ids)  SELECT valid.universe_id,
                     incoming."typeId",
                     incoming."groupId",
                     incoming.name,
                     incoming."groupIds"
                    FROM (valid
                      CROSS JOIN incoming) ON CONFLICT DO NOTHING
           RETURNING market_intelligence_excluded_targets.type_id
         )
  SELECT jsonb_build_object('outcome',
         CASE
             WHEN (EXISTS ( SELECT 1
                FROM valid)) THEN 'staged'::text
             WHEN (EXISTS ( SELECT 1
                FROM eligible)) THEN 'inconsistent'::text
             ELSE 'obsolete'::text
         END) AS jsonb_build_object;
END;

