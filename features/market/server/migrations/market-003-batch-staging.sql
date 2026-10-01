create function eve_module_market.persist_stage_market_pages(input jsonb)
returns jsonb
language sql
volatile
parallel unsafe
begin atomic
  select profile.profile_id
  from market_profiles as profile
  join market_observations as observation on observation.profile_id = profile.profile_id
  where observation.observation_id = (input ->> 'observationId'::text)::uuid
  for share of profile;

  select observation.observation_id
  from market_observations as observation
  where observation.observation_id = (input ->> 'observationId'::text)::uuid
  for update of observation;

  with pages as materialized (
    select item.page, item."validatedAt" as validated_at,
      item."freshUntil" as fresh_until, item.orders,
      jsonb_array_length(item.orders) as row_count
    from jsonb_to_recordset(input -> 'pages'::text) as item (
      page integer, "validatedAt" pg_catalog.timestamptz,
      "freshUntil" pg_catalog.timestamptz, orders jsonb
    )
  ), eligible as materialized (
    select observation.observation_id, observation.expected_pages
    from market_observations as observation
    join market_profiles as profile on profile.profile_id = observation.profile_id
    where observation.observation_id = (input ->> 'observationId'::text)::uuid
      and observation.status = 'staging'::text
      and profile.enabled
      and profile.revision = observation.profile_revision
      and observation.expected_pages = (input ->> 'expectedPages'::text)::integer
      and ((select count(*) from pages) >= 1 and (select count(*) from pages) <= 20)
      and (select count(distinct page) from pages) = (select count(*) from pages)
      and (select sum(row_count) from pages) <= 20000
      and not exists (
        select 1 from pages
        where page < 1 or page > observation.expected_pages
          or row_count > 1000 or fresh_until <= validated_at
      )
      and not exists (
        select 1 from pages as incoming
        join market_observation_pages as stored
          on stored.observation_id = observation.observation_id and stored.page = incoming.page
        where stored.expected_pages <> observation.expected_pages
          or stored.validated_at <> incoming.validated_at
          or stored.fresh_until <> incoming.fresh_until
          or stored.row_count <> incoming.row_count
      )
  ), inserted_pages as (
    insert into market_observation_pages (
      observation_id, page, expected_pages, validated_at, fresh_until, row_count
    )
    select eligible.observation_id, pages.page, eligible.expected_pages,
      pages.validated_at, pages.fresh_until, pages.row_count
    from eligible cross join pages
    on conflict (observation_id, page) do nothing
    returning market_observation_pages.page
  ), inserted_orders as (
    insert into market_observation_orders (
      observation_id, order_id, type_id, location_id, system_id,
      side, price, volume_remain, issued_at, duration_days,
      minimum_volume, order_range
    )
    select eligible.observation_id,
      item."orderId", item."typeId", item."locationId", item."solarSystemId",
      item.side, item.price, item."volumeRemain", item."issuedAt",
      item."durationDays", item."minimumVolume", item.range
    from eligible cross join pages
    cross join (select count(*) from inserted_pages) as completed_pages
    cross join lateral jsonb_to_recordset(pages.orders) as item (
      "orderId" bigint, "typeId" bigint, "locationId" bigint, "solarSystemId" bigint,
      side text, price numeric(20, 2), "volumeRemain" bigint, "issuedAt" pg_catalog.timestamptz,
      "durationDays" integer, "minimumVolume" bigint, range text
    )
    on conflict (observation_id, order_id) do nothing
    returning market_observation_orders.order_id
  )
  select jsonb_build_object('outcome'::text,
    case when exists (select 1 from eligible) then 'staged'::text else 'obsolete'::text end);
end;
