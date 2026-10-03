create table asset_inventory_observations (
  character_id bigint primary key references asset_snapshots(character_id) on delete cascade,
  observation_id uuid not null,
  validated_at timestamptz not null,
  ready boolean not null,
  organization_version bigint not null,
  target_user_id uuid not null,
  managed_member_lifecycle_id uuid not null,
  character_lifecycle_id uuid not null,
  authorization_generation integer not null,
  disclosure_version integer not null,
  section_activation_version integer not null,

  unique (character_id, observation_id)
);

create table asset_inventory_items (
  character_id bigint not null,
  observation_id uuid not null,
  item_id bigint not null,
  type_id bigint not null,
  quantity numeric(40,0) not null check (quantity > 0),
  blueprint text not null check (blueprint in ('none', 'original', 'copy')),
  location_key text not null,
  location_id bigint,
  location_state text not null check (location_state in ('resolved', 'unknown', 'restricted', 'unresolved')),
  location_name text,
  type_name text,
  group_id bigint,
  category_id bigint,
  primary key (character_id, observation_id, item_id),
  foreign key (character_id, observation_id)
    references asset_inventory_observations(character_id, observation_id) on delete cascade
);

create index asset_inventory_group_idx on asset_inventory_items
  (type_id, blueprint, location_key, character_id, observation_id);
create index asset_inventory_conflict_idx on asset_inventory_items (item_id, character_id);

CREATE FUNCTION eve_module_member_audit.persist_backfill_asset_inventory(input jsonb)
 RETURNS jsonb
 LANGUAGE sql VOLATILE PARALLEL UNSAFE
BEGIN ATOMIC
 WITH selected AS MATERIALIZED (
          SELECT s_1.organization_version,
             s_1.target_user_id,
             s_1.managed_member_lifecycle_id,
             s_1.character_id,
             s_1.character_lifecycle_id,
             s_1.authorization_generation,
             s_1.disclosure_version,
             s_1.section_activation_version,
             s_1.dto_revision,
             s_1.observation_id,
             s_1.snapshot,
             s_1.validated_at
            FROM (jsonb_array_elements((input -> 'subjects'::text)) requested(subject)
              JOIN asset_snapshots s_1 ON (((s_1.organization_version = ((requested.subject ->> 'organizationVersion'::text))::bigint) AND (s_1.target_user_id = ((requested.subject ->> 'targetUserId'::text))::uuid) AND (s_1.managed_member_lifecycle_id = ((requested.subject ->> 'managedMemberLifecycleId'::text))::uuid) AND (s_1.character_id = ((requested.subject ->> 'characterId'::text))::bigint) AND (s_1.character_lifecycle_id = ((requested.subject ->> 'characterLifecycleId'::text))::uuid) AND (s_1.authorization_generation = ((requested.subject ->> 'authorizationGeneration'::text))::integer) AND (s_1.disclosure_version = ((requested.subject ->> 'disclosureVersion'::text))::integer) AND (s_1.section_activation_version = ((requested.subject ->> 'sectionActivationVersion'::text))::integer) AND (s_1.dto_revision = 1) AND (((requested.subject ->> 'observationId'::text) IS NULL) OR (s_1.observation_id = ((requested.subject ->> 'observationId'::text))::uuid)))))
          FOR UPDATE OF s_1
         )
  DELETE FROM asset_inventory_observations h
    USING selected s
   WHERE ((h.character_id = s.character_id) AND ((h.observation_id <> s.observation_id) OR (h.validated_at <> s.validated_at) OR ((h.organization_version <> s.organization_version) OR (h.target_user_id <> s.target_user_id) OR (h.managed_member_lifecycle_id <> s.managed_member_lifecycle_id) OR (h.character_lifecycle_id <> s.character_lifecycle_id) OR (h.authorization_generation <> s.authorization_generation) OR (h.disclosure_version <> s.disclosure_version) OR (h.section_activation_version <> s.section_activation_version))));
 WITH selected AS MATERIALIZED (
          SELECT s.organization_version,
             s.target_user_id,
             s.managed_member_lifecycle_id,
             s.character_id,
             s.character_lifecycle_id,
             s.authorization_generation,
             s.disclosure_version,
             s.section_activation_version,
             s.dto_revision,
             s.observation_id,
             s.snapshot,
             s.validated_at
            FROM (jsonb_array_elements((input -> 'subjects'::text)) requested(subject)
              JOIN asset_snapshots s ON (((s.organization_version = ((requested.subject ->> 'organizationVersion'::text))::bigint) AND (s.target_user_id = ((requested.subject ->> 'targetUserId'::text))::uuid) AND (s.managed_member_lifecycle_id = ((requested.subject ->> 'managedMemberLifecycleId'::text))::uuid) AND (s.character_id = ((requested.subject ->> 'characterId'::text))::bigint) AND (s.character_lifecycle_id = ((requested.subject ->> 'characterLifecycleId'::text))::uuid) AND (s.authorization_generation = ((requested.subject ->> 'authorizationGeneration'::text))::integer) AND (s.disclosure_version = ((requested.subject ->> 'disclosureVersion'::text))::integer) AND (s.section_activation_version = ((requested.subject ->> 'sectionActivationVersion'::text))::integer) AND (s.dto_revision = 1) AND (((requested.subject ->> 'observationId'::text) IS NULL) OR (s.observation_id = ((requested.subject ->> 'observationId'::text))::uuid)))))
         ), records AS (
          SELECT s.character_id,
             raw.record,
             jsonb_build_array((raw.record -> 'typeId'::text), (raw.record -> 'quantity'::text), (raw.record -> 'isSingleton'::text), (raw.record -> 'isBlueprintCopy'::text), (raw.record -> 'locationId'::text), (raw.record -> 'locationType'::text), (raw.record -> 'locationFlag'::text), (raw.record -> 'parentItemId'::text)) AS signature
            FROM (selected s
              CROSS JOIN LATERAL jsonb_array_elements((s.snapshot -> 'records'::text)) raw(record))
         )
  INSERT INTO asset_inventory_observations (character_id, observation_id, validated_at, organization_version, target_user_id, managed_member_lifecycle_id, character_lifecycle_id, authorization_generation, disclosure_version, section_activation_version, ready)  SELECT s.character_id,
             s.observation_id,
             s.validated_at,
             s.organization_version,
             s.target_user_id,
             s.managed_member_lifecycle_id,
             s.character_lifecycle_id,
             s.authorization_generation,
             s.disclosure_version,
             s.section_activation_version,
             ((jsonb_array_length((s.snapshot -> 'records'::text)) <= 10000) AND (NOT (EXISTS ( SELECT
                    FROM records r
                   WHERE ((r.character_id = s.character_id) AND (((jsonb_typeof((r.record -> 'quantity'::text)) = 'number'::text) AND ((((r.record ->> 'quantity'::text))::numeric >= (1)::numeric) AND (((r.record ->> 'quantity'::text))::numeric <= ('9007199254740991'::bigint)::numeric)) AND (trunc(((r.record ->> 'quantity'::text))::numeric) = ((r.record ->> 'quantity'::text))::numeric) AND ((((r.record ->> 'itemId'::text))::numeric >= (1)::numeric) AND (((r.record ->> 'itemId'::text))::numeric <= ('9007199254740991'::bigint)::numeric)) AND ((((r.record ->> 'typeId'::text))::numeric >= (1)::numeric) AND (((r.record ->> 'typeId'::text))::numeric <= ('9007199254740991'::bigint)::numeric)) AND ((((r.record ->> 'locationId'::text))::numeric >= (1)::numeric) AND (((r.record ->> 'locationId'::text))::numeric <= ('9007199254740991'::bigint)::numeric)) AND (jsonb_typeof((r.record -> 'itemId'::text)) = 'number'::text) AND (trunc(((r.record ->> 'itemId'::text))::numeric) = ((r.record ->> 'itemId'::text))::numeric) AND (jsonb_typeof((r.record -> 'typeId'::text)) = 'number'::text) AND (trunc(((r.record ->> 'typeId'::text))::numeric) = ((r.record ->> 'typeId'::text))::numeric) AND (jsonb_typeof((r.record -> 'locationId'::text)) = 'number'::text) AND (trunc(((r.record ->> 'locationId'::text))::numeric) = ((r.record ->> 'locationId'::text))::numeric) AND ((r.record ->> 'locationType'::text) = ANY (ARRAY['station'::text, 'solar_system'::text, 'other'::text, 'item'::text])) AND
                         CASE
                             WHEN ((r.record ->> 'locationType'::text) = 'item'::text) THEN ((r.record -> 'parentItemId'::text) = (r.record -> 'locationId'::text))
                             ELSE ((r.record -> 'parentItemId'::text) = 'null'::jsonb)
                         END) IS NOT TRUE))))) AND (NOT (EXISTS ( SELECT
                    FROM records r
                   WHERE (r.character_id = s.character_id)
                   GROUP BY (r.record -> 'itemId'::text)
                  HAVING (count(DISTINCT r.signature) > 1)))))
            FROM selected s WHERE NOT EXISTS (SELECT FROM asset_inventory_observations existing WHERE existing.character_id = s.character_id) ON CONFLICT(character_id) DO NOTHING;
 WITH RECURSIVE selected AS MATERIALIZED (
          SELECT s.organization_version,
             s.target_user_id,
             s.managed_member_lifecycle_id,
             s.character_id,
             s.character_lifecycle_id,
             s.authorization_generation,
             s.disclosure_version,
             s.section_activation_version,
             s.dto_revision,
             s.observation_id,
             s.snapshot,
             s.validated_at
            FROM (jsonb_array_elements((input -> 'subjects'::text)) requested(subject)
              JOIN asset_snapshots s ON (((s.organization_version = ((requested.subject ->> 'organizationVersion'::text))::bigint) AND (s.target_user_id = ((requested.subject ->> 'targetUserId'::text))::uuid) AND (s.managed_member_lifecycle_id = ((requested.subject ->> 'managedMemberLifecycleId'::text))::uuid) AND (s.character_id = ((requested.subject ->> 'characterId'::text))::bigint) AND (s.character_lifecycle_id = ((requested.subject ->> 'characterLifecycleId'::text))::uuid) AND (s.authorization_generation = ((requested.subject ->> 'authorizationGeneration'::text))::integer) AND (s.disclosure_version = ((requested.subject ->> 'disclosureVersion'::text))::integer) AND (s.section_activation_version = ((requested.subject ->> 'sectionActivationVersion'::text))::integer) AND (s.dto_revision = 1) AND (((requested.subject ->> 'observationId'::text) IS NULL) OR (s.observation_id = ((requested.subject ->> 'observationId'::text))::uuid)))))
         ), records AS MATERIALIZED (
          SELECT DISTINCT ON (s.character_id, ((raw.record ->> 'itemId'::text))::bigint) s.character_id,
             s.observation_id,
             raw.record,
             ((raw.record ->> 'itemId'::text))::bigint AS item_id,
             ((raw.record ->> 'parentItemId'::text))::bigint AS parent_item_id
            FROM ((selected s
              JOIN asset_inventory_observations h ON (((h.character_id = s.character_id) AND (h.observation_id = s.observation_id) AND ((h.organization_version = s.organization_version) AND (h.target_user_id = s.target_user_id) AND (h.managed_member_lifecycle_id = s.managed_member_lifecycle_id) AND (h.character_lifecycle_id = s.character_lifecycle_id) AND (h.authorization_generation = s.authorization_generation) AND (h.disclosure_version = s.disclosure_version) AND (h.section_activation_version = s.section_activation_version)) AND h.ready)))
              CROSS JOIN LATERAL jsonb_array_elements((s.snapshot -> 'records'::text)) raw(record))
           WHERE NOT EXISTS (SELECT FROM asset_inventory_items existing WHERE existing.character_id = s.character_id AND existing.observation_id = s.observation_id)
           ORDER BY s.character_id, ((raw.record ->> 'itemId'::text))::bigint
         ), roots AS (
          SELECT r.character_id,
             r.item_id,
             (((r.record ->> 'locationType'::text) || ':'::text) || (r.record ->> 'locationId'::text)) AS location_key,
             ((r.record ->> 'locationId'::text))::bigint AS location_id,
                 CASE
                     WHEN ((r.record ->> 'locationType'::text) = 'other'::text) THEN 'restricted'::text
                     WHEN ((r.record ->> 'locationName'::text) IS NULL) THEN 'unknown'::text
                     ELSE 'resolved'::text
                 END AS location_state,
                 CASE
                     WHEN ((r.record ->> 'locationType'::text) = 'other'::text) THEN NULL::text
                     ELSE (r.record ->> 'locationName'::text)
                 END AS location_name
            FROM records r
           WHERE (r.parent_item_id IS NULL)
         UNION ALL
          SELECT child.character_id,
             child.item_id,
             parent.location_key,
             parent.location_id,
             parent.location_state,
             parent.location_name
            FROM (roots parent
              JOIN records child ON (((child.character_id = parent.character_id) AND (child.parent_item_id = parent.item_id))))
         )
  INSERT INTO asset_inventory_items (character_id, observation_id, item_id, type_id, quantity, blueprint, location_key, location_id, location_state, location_name, type_name, group_id, category_id)  SELECT r.character_id,
             r.observation_id,
             r.item_id,
             ((r.record ->> 'typeId'::text))::bigint AS int8,
             ((r.record ->> 'quantity'::text))::numeric AS "numeric",
                 CASE
                     WHEN ((r.record ->> 'isBlueprintCopy'::text) = 'true'::text) THEN 'copy'::text
                     WHEN (((r.record ->> 'categoryId'::text))::bigint = 9) THEN 'original'::text
                     ELSE 'none'::text
                 END AS "case",
             COALESCE(root.location_key, 'unresolved'::text) AS "coalesce",
             root.location_id,
             COALESCE(root.location_state, 'unresolved'::text) AS "coalesce",
             root.location_name,
             (r.record ->> 'typeName'::text),
             ((r.record ->> 'groupId'::text))::bigint AS int8,
             ((r.record ->> 'categoryId'::text))::bigint AS int8
            FROM (records r
              LEFT JOIN roots root ON (((root.character_id = r.character_id) AND (root.item_id = r.item_id)))) ON CONFLICT DO NOTHING;
 WITH selected AS (
          SELECT s_1.organization_version,
             s_1.target_user_id,
             s_1.managed_member_lifecycle_id,
             s_1.character_id,
             s_1.character_lifecycle_id,
             s_1.authorization_generation,
             s_1.disclosure_version,
             s_1.section_activation_version,
             s_1.dto_revision,
             s_1.observation_id,
             s_1.snapshot,
             s_1.validated_at
            FROM (jsonb_array_elements((input -> 'subjects'::text)) requested(subject)
              JOIN asset_snapshots s_1 ON (((s_1.organization_version = ((requested.subject ->> 'organizationVersion'::text))::bigint) AND (s_1.target_user_id = ((requested.subject ->> 'targetUserId'::text))::uuid) AND (s_1.managed_member_lifecycle_id = ((requested.subject ->> 'managedMemberLifecycleId'::text))::uuid) AND (s_1.character_id = ((requested.subject ->> 'characterId'::text))::bigint) AND (s_1.character_lifecycle_id = ((requested.subject ->> 'characterLifecycleId'::text))::uuid) AND (s_1.authorization_generation = ((requested.subject ->> 'authorizationGeneration'::text))::integer) AND (s_1.disclosure_version = ((requested.subject ->> 'disclosureVersion'::text))::integer) AND (s_1.section_activation_version = ((requested.subject ->> 'sectionActivationVersion'::text))::integer) AND (s_1.dto_revision = 1) AND (((requested.subject ->> 'observationId'::text) IS NULL) OR (s_1.observation_id = ((requested.subject ->> 'observationId'::text))::uuid)))))
         )
  SELECT jsonb_build_object('projected', (count(*))::integer) AS jsonb_build_object
    FROM (selected s
      JOIN asset_inventory_observations h ON (((h.character_id = s.character_id) AND (h.observation_id = s.observation_id) AND ((h.organization_version = s.organization_version) AND (h.target_user_id = s.target_user_id) AND (h.managed_member_lifecycle_id = s.managed_member_lifecycle_id) AND (h.character_lifecycle_id = s.character_lifecycle_id) AND (h.authorization_generation = s.authorization_generation) AND (h.disclosure_version = s.disclosure_version) AND (h.section_activation_version = s.section_activation_version)) AND h.ready)));
END
;

CREATE FUNCTION eve_module_member_audit.persist_promote_asset_inventory(input jsonb)
 RETURNS jsonb
 LANGUAGE sql VOLATILE PARALLEL UNSAFE
BEGIN ATOMIC
 WITH promoted AS MATERIALIZED (
          SELECT persist_promote_evidence_observation(input) AS result
         ), projected AS MATERIALIZED (
          SELECT persist_backfill_asset_inventory(jsonb_build_object('subjects', jsonb_build_array(input))) AS result
            FROM promoted promoted_1
           WHERE (((promoted_1.result ->> 'outcome'::text) = 'applied'::text) AND ((input ->> 'resourceId'::text) = 'assets'::text))
         )
  SELECT (promoted.result || COALESCE((projected.result - 'projected'::text), '{}'::jsonb))
    FROM (promoted
      LEFT JOIN projected ON (true));
END
;

CREATE FUNCTION eve_module_member_audit.persist_read_inventory_sources(input jsonb)
 RETURNS jsonb
 LANGUAGE sql STABLE PARALLEL UNSAFE
BEGIN ATOMIC
 SELECT COALESCE(jsonb_agg(jsonb_build_object('characterId', ((requested.subject ->> 'characterId'::text))::bigint, 'observationId', s.observation_id, 'validatedAt', s.validated_at, 'ready', COALESCE(h.ready, false)) ORDER BY ((requested.subject ->> 'characterId'::text))::bigint), '[]'::jsonb) AS "coalesce"
    FROM ((jsonb_array_elements((input -> 'subjects'::text)) requested(subject)
      LEFT JOIN asset_snapshots s ON (((s.organization_version = ((requested.subject ->> 'organizationVersion'::text))::bigint) AND (s.target_user_id = ((requested.subject ->> 'targetUserId'::text))::uuid) AND (s.managed_member_lifecycle_id = ((requested.subject ->> 'managedMemberLifecycleId'::text))::uuid) AND (s.character_id = ((requested.subject ->> 'characterId'::text))::bigint) AND (s.character_lifecycle_id = ((requested.subject ->> 'characterLifecycleId'::text))::uuid) AND (s.authorization_generation = ((requested.subject ->> 'authorizationGeneration'::text))::integer) AND (s.disclosure_version = ((requested.subject ->> 'disclosureVersion'::text))::integer) AND (s.section_activation_version = ((requested.subject ->> 'sectionActivationVersion'::text))::integer) AND (s.dto_revision = 1) AND (((requested.subject ->> 'observationId'::text) IS NULL) OR (s.observation_id = ((requested.subject ->> 'observationId'::text))::uuid)))))
      LEFT JOIN asset_inventory_observations h ON (((h.character_id = s.character_id) AND (h.observation_id = s.observation_id) AND (h.validated_at = s.validated_at) AND ((h.organization_version = s.organization_version) AND (h.target_user_id = s.target_user_id) AND (h.managed_member_lifecycle_id = s.managed_member_lifecycle_id) AND (h.character_lifecycle_id = s.character_lifecycle_id) AND (h.authorization_generation = s.authorization_generation) AND (h.disclosure_version = s.disclosure_version) AND (h.section_activation_version = s.section_activation_version)))));
END
;

CREATE FUNCTION eve_module_member_audit.persist_read_asset_inventory(input jsonb)
 RETURNS jsonb
 LANGUAGE sql STABLE PARALLEL UNSAFE
BEGIN ATOMIC
 WITH selected AS MATERIALIZED (
          SELECT s.character_id,
             s.observation_id,
             ((requested.subject ->> 'stale'::text))::boolean AS stale
            FROM ((jsonb_array_elements((input -> 'subjects'::text)) requested(subject)
              JOIN asset_snapshots s ON (((s.organization_version = ((requested.subject ->> 'organizationVersion'::text))::bigint) AND (s.target_user_id = ((requested.subject ->> 'targetUserId'::text))::uuid) AND (s.managed_member_lifecycle_id = ((requested.subject ->> 'managedMemberLifecycleId'::text))::uuid) AND (s.character_id = ((requested.subject ->> 'characterId'::text))::bigint) AND (s.character_lifecycle_id = ((requested.subject ->> 'characterLifecycleId'::text))::uuid) AND (s.authorization_generation = ((requested.subject ->> 'authorizationGeneration'::text))::integer) AND (s.disclosure_version = ((requested.subject ->> 'disclosureVersion'::text))::integer) AND (s.section_activation_version = ((requested.subject ->> 'sectionActivationVersion'::text))::integer) AND (s.dto_revision = 1) AND (s.observation_id = ((requested.subject ->> 'observationId'::text))::uuid))))
              JOIN asset_inventory_observations h ON (((h.character_id = s.character_id) AND (h.observation_id = s.observation_id) AND (h.validated_at = s.validated_at) AND ((h.organization_version = s.organization_version) AND (h.target_user_id = s.target_user_id) AND (h.managed_member_lifecycle_id = s.managed_member_lifecycle_id) AND (h.character_lifecycle_id = s.character_lifecycle_id) AND (h.authorization_generation = s.authorization_generation) AND (h.disclosure_version = s.disclosure_version) AND (h.section_activation_version = s.section_activation_version)) AND h.ready)))
         ), items AS MATERIALIZED (
          SELECT item.character_id,
             item.observation_id,
             item.item_id,
             item.type_id,
             item.quantity,
             item.blueprint,
             item.location_key,
             item.location_id,
             item.location_state,
             item.location_name,
             item.type_name,
             item.group_id,
             item.category_id,
             selected.stale,
             replace((jsonb_build_array(item.type_id, item.blueprint, item.location_key))::text, ', '::text, ','::text) AS group_key
            FROM (selected
              JOIN asset_inventory_items item USING (character_id, observation_id))
         ), conflicts AS MATERIALIZED (
          SELECT items.item_id
            FROM items
           GROUP BY items.item_id
          HAVING (count(DISTINCT items.character_id) > 1)
         ), clean AS (
          SELECT items.character_id,
             items.observation_id,
             items.item_id,
             items.type_id,
             items.quantity,
             items.blueprint,
             items.location_key,
             items.location_id,
             items.location_state,
             items.location_name,
             items.type_name,
             items.group_id,
             items.category_id,
             items.stale,
             items.group_key
            FROM items
           WHERE ((NOT (EXISTS ( SELECT
                    FROM conflicts
                   WHERE (conflicts.item_id = items.item_id)))) AND ((((input -> 'filters'::text) ->> 'typeId'::text) IS NULL) OR (items.type_id = (((input -> 'filters'::text) ->> 'typeId'::text))::bigint)) AND ((((input -> 'filters'::text) ->> 'groupId'::text) IS NULL) OR (items.group_id = (((input -> 'filters'::text) ->> 'groupId'::text))::bigint)) AND ((((input -> 'filters'::text) ->> 'categoryId'::text) IS NULL) OR (items.category_id = (((input -> 'filters'::text) ->> 'categoryId'::text))::bigint)) AND ((((input -> 'filters'::text) ->> 'locationKey'::text) IS NULL) OR (items.location_key = ((input -> 'filters'::text) ->> 'locationKey'::text))))
         ), groups AS (
          SELECT clean.group_key,
             clean.type_id,
             clean.blueprint,
             clean.location_key,
             max(clean.type_name) AS type_name,
             max(clean.group_id) AS group_id,
             max(clean.category_id) AS category_id,
             max(clean.location_id) AS location_id,
             max(clean.location_name) AS location_name,
             max(clean.location_state) AS location_state,
             (COALESCE(sum(clean.quantity) FILTER (WHERE (NOT clean.stale)), (0)::numeric))::text AS current_quantity,
             (COALESCE(sum(clean.quantity) FILTER (WHERE clean.stale), (0)::numeric))::text AS stale_quantity
            FROM clean
           GROUP BY clean.group_key, clean.type_id, clean.blueprint, clean.location_key
         ), group_page AS MATERIALIZED (
          SELECT groups.group_key,
             groups.type_id,
             groups.blueprint,
             groups.location_key,
             groups.type_name,
             groups.group_id,
             groups.category_id,
             groups.location_id,
             groups.location_name,
             groups.location_state,
             groups.current_quantity,
             groups.stale_quantity
            FROM groups
           WHERE (((input ->> 'kind'::text) = 'groups'::text) AND (((input ->> 'after'::text) IS NULL) OR (ROW(groups.type_id, groups.blueprint, groups.location_key) > ROW(((((input ->> 'after'::text))::jsonb ->> 0))::bigint, (((input ->> 'after'::text))::jsonb ->> 1), (((input ->> 'after'::text))::jsonb ->> 2)))))
           ORDER BY groups.type_id, groups.blueprint, groups.location_key
          LIMIT (((input ->> 'first'::text))::integer + 1)
         ), holders AS (
          SELECT clean.character_id,
             clean.group_key,
             (COALESCE(sum(clean.quantity) FILTER (WHERE (NOT clean.stale)), (0)::numeric))::text AS current_quantity,
             (COALESCE(sum(clean.quantity) FILTER (WHERE clean.stale), (0)::numeric))::text AS stale_quantity
            FROM clean
           WHERE (clean.group_key = (input ->> 'groupKey'::text))
           GROUP BY clean.character_id, clean.group_key
         ), holder_page AS MATERIALIZED (
          SELECT holders.character_id,
             holders.group_key,
             holders.current_quantity,
             holders.stale_quantity
            FROM holders
           WHERE (((input ->> 'kind'::text) = 'holders'::text) AND (((input ->> 'after'::text) IS NULL) OR (holders.character_id > ((input ->> 'after'::text))::bigint)))
           ORDER BY holders.character_id
          LIMIT (((input ->> 'first'::text))::integer + 1)
         )
  SELECT jsonb_build_object('groups', COALESCE(( SELECT jsonb_agg(jsonb_build_object('key', page.group_key, 'typeId', page.type_id, 'typeName', page.type_name, 'groupId', page.group_id, 'categoryId', page.category_id, 'blueprint', page.blueprint, 'location', jsonb_build_object('key', page.location_key, 'id', (page.location_id)::text, 'name', page.location_name, 'state', page.location_state), 'currentQuantity', page.current_quantity, 'staleQuantity', page.stale_quantity) ORDER BY page.type_id, page.blueprint, page.location_key) AS jsonb_agg
            FROM ( SELECT group_page.group_key,
                     group_page.type_id,
                     group_page.blueprint,
                     group_page.location_key,
                     group_page.type_name,
                     group_page.group_id,
                     group_page.category_id,
                     group_page.location_id,
                     group_page.location_name,
                     group_page.location_state,
                     group_page.current_quantity,
                     group_page.stale_quantity
                    FROM group_page
                   ORDER BY group_page.type_id, group_page.blueprint, group_page.location_key
                  LIMIT ((input ->> 'first'::text))::integer) page), '[]'::jsonb), 'holders', COALESCE(( SELECT jsonb_agg(jsonb_build_object('characterId', page.character_id, 'groupKey', page.group_key, 'currentQuantity', page.current_quantity, 'staleQuantity', page.stale_quantity) ORDER BY page.character_id) AS jsonb_agg
            FROM ( SELECT holder_page.character_id,
                     holder_page.group_key,
                     holder_page.current_quantity,
                     holder_page.stale_quantity
                    FROM holder_page
                   ORDER BY holder_page.character_id
                  LIMIT ((input ->> 'first'::text))::integer) page), '[]'::jsonb), 'hasNextPage', ((( SELECT count(*) AS count
            FROM group_page) > ((input ->> 'first'::text))::integer) OR (( SELECT count(*) AS count
            FROM holder_page) > ((input ->> 'first'::text))::integer)), 'conflictingCharacters', COALESCE(( SELECT jsonb_agg(affected.character_id ORDER BY affected.character_id) AS jsonb_agg
            FROM ( SELECT DISTINCT items.character_id
                    FROM (items
                      JOIN conflicts USING (item_id))) affected), '[]'::jsonb)) AS jsonb_build_object;
END
;

