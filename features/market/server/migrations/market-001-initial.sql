create table market_profiles (
  profile_id uuid primary key,
  region_id bigint not null check (region_id > 0),
  mode text not null check (mode in ('region', 'watched-types')),
  station_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(station_ids) = 'array'),
  watched_type_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(watched_type_ids) = 'array'),
  enabled boolean not null default false,
  revision bigint not null default 1 check (revision > 0),
  last_request_id uuid not null,
  next_due_at timestamptz,
  last_failure_class text,
  last_failure_id uuid,
  updated_at timestamptz not null default now(),
  check ((mode = 'region' and jsonb_array_length(watched_type_ids) = 0)
    or (mode = 'watched-types' and jsonb_array_length(watched_type_ids) between 1 and 16)),
  check (jsonb_array_length(station_ids) <= 100)
);
create index market_profiles_due_idx on market_profiles (next_due_at, profile_id) where enabled;
create unique index market_profiles_single_enabled_region_idx
  on market_profiles (enabled) where mode = 'region' and enabled;

create table market_profile_capacity (
  singleton boolean primary key default true check (singleton),
  maximum_profiles integer not null default 4 check (maximum_profiles = 4)
);
insert into market_profile_capacity (singleton) values (true);

create table market_observations (
  observation_id uuid primary key,
  profile_id uuid not null references market_profiles (profile_id),
  profile_revision bigint not null,
  market_key text not null,
  region_id bigint not null,
  type_id bigint,
  expected_pages integer not null check (expected_pages between 1 and 512),
  status text not null check (status in ('staging', 'complete', 'failed')),
  started_at timestamptz not null,
  observed_at timestamptz,
  earliest_validated_at timestamptz,
  latest_validated_at timestamptz,
  fresh_until timestamptz,
  published_at timestamptz,
  order_count integer not null default 0 check (order_count between 0 and 512000)
);
create index market_observations_retention_idx on market_observations (started_at);

create table market_observation_pages (
  observation_id uuid not null references market_observations (observation_id) on delete cascade,
  page integer not null check (page between 1 and 512),
  expected_pages integer not null check (expected_pages between 1 and 512),
  validated_at timestamptz not null,
  fresh_until timestamptz not null,
  row_count integer not null check (row_count between 0 and 1000),
  primary key (observation_id, page)
);

create table market_observation_orders (
  observation_id uuid not null references market_observations (observation_id) on delete cascade,
  order_id bigint not null,
  type_id bigint not null,
  location_id bigint not null,
  system_id bigint,
  side text not null check (side in ('buy', 'sell')),
  price numeric(20, 2) not null check (price >= 0),
  volume_remain bigint not null check (volume_remain >= 0),
  issued_at timestamptz not null,
  duration_days integer not null check (duration_days >= 0),
  minimum_volume bigint not null check (minimum_volume > 0),
  order_range text not null,
  primary key (observation_id, order_id)
);
create index market_observation_orders_type_side_price_idx
  on market_observation_orders (observation_id, type_id, side, price, order_id);

create table market_current_observations (
  market_key text primary key,
  observation_id uuid not null unique references market_observations (observation_id),
  observed_at timestamptz not null
);

create table market_daily_history (
  region_id bigint not null,
  type_id bigint not null,
  day date not null,
  average numeric(20, 2) not null,
  highest numeric(20, 2) not null,
  lowest numeric(20, 2) not null,
  volume bigint not null,
  order_count bigint not null,
  validated_at timestamptz not null,
  primary key (region_id, type_id, day)
);

create table market_reference_prices (
  type_id bigint not null,
  observed_hour timestamptz not null,
  adjusted_price numeric(20, 2),
  average_price numeric(20, 2),
  validated_at timestamptz not null,
  primary key (type_id, observed_hour)
);

create table market_derived_metrics (
  observation_id uuid not null,
  profile_id uuid,
  profile_revision bigint,
  region_id bigint,
  type_id bigint not null,
  derivation_version integer not null check (derivation_version > 0),
  metrics jsonb not null,
  observed_at timestamptz not null,
  primary key (observation_id, type_id, derivation_version)
);
create index market_derived_metrics_range_idx on market_derived_metrics (type_id, observed_at);
create index market_derived_metrics_profile_range_idx
  on market_derived_metrics (profile_id, type_id, observed_at, observation_id);

create table market_history_demands (
  profile_id uuid not null references market_profiles (profile_id),
  type_id bigint not null check (type_id > 0),
  profile_revision bigint not null,
  requested_at timestamptz not null,
  last_request_id uuid not null,
  primary key (profile_id, type_id)
);

create table market_history_collection_state (
  profile_id uuid not null references market_profiles (profile_id),
  type_id bigint not null check (type_id > 0),
  profile_revision bigint not null,
  next_due_at timestamptz,
  validated_at timestamptz,
  fresh_until timestamptz,
  last_failure_class text,
  last_attempt_id uuid not null,
  primary key (profile_id, type_id)
);
create index market_history_collection_due_idx
  on market_history_collection_state (next_due_at, profile_id, type_id);

create table market_history_profile_failures (
  profile_id uuid primary key references market_profiles (profile_id),
  profile_revision bigint not null,
  next_allowed_at timestamptz,
  last_failure_class text not null,
  last_failure_id uuid not null
);

create table market_structure_observations (
  observation_id uuid primary key,
  character_id bigint not null,
  subject_lifecycle_id uuid not null,
  authorization_generation integer not null check (authorization_generation >= 0),
  organization_version bigint not null check (organization_version > 0),
  structure_id bigint not null check (structure_id > 0),
  expected_pages integer not null check (expected_pages between 1 and 32),
  status text not null check (status in ('staging', 'complete')),
  started_at timestamptz not null,
  observed_at timestamptz,
  validated_at timestamptz,
  fresh_until timestamptz,
  order_count integer not null default 0 check (order_count between 0 and 32000)
);
create index market_structure_observations_retention_idx
  on market_structure_observations (started_at);

create table market_structure_pages (
  observation_id uuid not null references market_structure_observations (observation_id) on delete cascade,
  page integer not null check (page between 1 and 32),
  expected_pages integer not null check (expected_pages between 1 and 32),
  validated_at timestamptz not null,
  fresh_until timestamptz not null,
  row_count integer not null check (row_count between 0 and 1000),
  primary key (observation_id, page)
);

create table market_structure_orders (
  observation_id uuid not null references market_structure_observations (observation_id) on delete cascade,
  order_id bigint not null,
  type_id bigint not null,
  location_id bigint not null,
  side text not null check (side in ('buy', 'sell')),
  price numeric(20, 2) not null check (price >= 0),
  volume_remain bigint not null check (volume_remain >= 0),
  issued_at timestamptz not null,
  duration_days integer not null check (duration_days >= 0),
  minimum_volume bigint not null check (minimum_volume > 0),
  order_range text not null,
  primary key (observation_id, order_id)
);
create index market_structure_orders_type_side_price_idx
  on market_structure_orders (observation_id, type_id, side, price, order_id);

create table market_structure_current (
  character_id bigint not null,
  subject_lifecycle_id uuid not null,
  authorization_generation integer not null,
  structure_id bigint not null,
  observation_id uuid not null unique references market_structure_observations (observation_id),
  observed_at timestamptz not null,
  primary key (character_id, subject_lifecycle_id, authorization_generation, structure_id)
);

create table market_structure_demands (
  character_id bigint not null,
  subject_lifecycle_id uuid not null,
  authorization_generation integer not null,
  organization_version bigint not null,
  structure_id bigint not null,
  requested_at timestamptz not null,
  last_request_id uuid not null,
  primary key (character_id, subject_lifecycle_id, authorization_generation,
    organization_version, structure_id)
);
create index market_structure_demands_retention_idx on market_structure_demands (requested_at);

create table market_type_failures (
  profile_id uuid not null references market_profiles (profile_id),
  type_id bigint not null check (type_id >= 0),
  profile_revision bigint not null,
  attempt_id uuid not null,
  attempted_at timestamptz not null,
  primary key (profile_id, type_id)
);

create function eve_module_market.persist_list_market_profiles(input jsonb)
returns jsonb
language sql
stable
parallel unsafe
return (
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'profileId'::text, profile_id,
      'regionId'::text, region_id,
      'mode'::text, mode,
      'stationIds'::text, station_ids,
      'watchedTypeIds'::text, watched_type_ids,
      'enabled'::text, enabled,
      'revision'::text, revision,
      'nextDueAt'::text, next_due_at,
      'lastFailureClass'::text, last_failure_class
    ) order by region_id, profile_id
  ), '[]'::jsonb)
  from market_profiles
  where (input ->> 'enabledOnly'::text)::boolean is not true or enabled
);

create function eve_module_market.persist_save_market_profile(input jsonb)
returns jsonb
language sql
volatile
parallel unsafe
begin atomic
  select capacity_lock.singleton
  from market_profile_capacity as capacity_lock
  for update of capacity_lock;

  insert into market_profiles (
    profile_id, region_id, mode, station_ids, watched_type_ids,
    enabled, revision, last_request_id, next_due_at
  )
  select
    (input ->> 'profileId'::text)::uuid,
    (input ->> 'regionId'::text)::bigint,
    input ->> 'mode'::text,
    input -> 'stationIds'::text,
    input -> 'watchedTypeIds'::text,
    (input ->> 'enabled'::text)::boolean,
    1,
    (input ->> 'requestId'::text)::uuid,
    case when (input ->> 'enabled'::text)::boolean then now() else null::timestamptz end as next_due_at
  from (
    select capacity_lock.singleton, capacity_lock.maximum_profiles
    from market_profile_capacity as capacity_lock
    for update of capacity_lock
  ) as capacity
  where ((input ->> 'expectedRevision'::text)::bigint > 0
    or (select count(*) from market_profiles) < capacity.maximum_profiles)
    and not (
      (input ->> 'enabled'::text)::boolean
      and input ->> 'mode'::text = 'region'::text
      and exists (
        select 1
        from market_profiles as enabled_region
        where enabled_region.enabled
          and enabled_region.mode = 'region'::text
          and enabled_region.profile_id <> (input ->> 'profileId'::text)::uuid
      )
    )
  on conflict (profile_id) do update
  set region_id = excluded.region_id,
      mode = excluded.mode,
      station_ids = excluded.station_ids,
      watched_type_ids = excluded.watched_type_ids,
      enabled = excluded.enabled,
      revision = market_profiles.revision + 1,
      last_request_id = excluded.last_request_id,
      next_due_at = case when excluded.enabled then now() else null::timestamptz end,
      updated_at = now()
  where market_profiles.revision = (input ->> 'expectedRevision'::text)::bigint;

  select coalesce(
    (select jsonb_build_object('outcome'::text, 'saved'::text, 'revision'::text, revision)
     from market_profiles
     where profile_id = (input ->> 'profileId'::text)::uuid
       and revision = (input ->> 'expectedRevision'::text)::bigint + 1
       and last_request_id = (input ->> 'requestId'::text)::uuid),
    jsonb_build_object('outcome'::text, 'obsolete'::text)
  );
end;

create function eve_module_market.persist_list_due_market_profiles(input jsonb)
returns jsonb
language sql
stable
parallel unsafe
return (
  select coalesce(jsonb_agg(
    jsonb_build_object('profileId'::text, profile_id, 'revision'::text, revision, 'nextDueAt'::text, next_due_at)
    order by next_due_at, profile_id
  ), '[]'::jsonb)
  from (
    select profile_id, revision, next_due_at
    from market_profiles
    where enabled and next_due_at <= (input ->> 'now'::text)::timestamptz
    order by next_due_at, profile_id
    limit 16
  ) as due
);

create function eve_module_market.persist_begin_market_observation(input jsonb)
returns jsonb
language sql
volatile
parallel unsafe
begin atomic
  insert into market_observations (
    observation_id, profile_id, profile_revision, market_key,
    region_id, type_id, expected_pages, status, started_at
  )
  select
    (input ->> 'observationId'::text)::uuid,
    profile.profile_id,
    profile.revision,
    input ->> 'marketKey'::text,
    profile.region_id,
    (input ->> 'typeId'::text)::bigint,
    (input ->> 'expectedPages'::text)::integer,
    'staging'::text,
    (input ->> 'startedAt'::text)::timestamptz
  from market_profiles as profile
  where profile.profile_id = (input ->> 'profileId'::text)::uuid
    and profile.revision = (input ->> 'profileRevision'::text)::bigint
    and profile.enabled
    and ((profile.mode = 'region'::text and (input ->> 'typeId'::text) is null)
      or (profile.mode = 'watched-types'::text
        and profile.watched_type_ids @> jsonb_build_array((input ->> 'typeId'::text)::bigint)))
  on conflict (observation_id) do nothing;

  select case when exists (
    select 1 from market_observations as observation
    where observation.observation_id = (input ->> 'observationId'::text)::uuid
      and observation.profile_revision = (input ->> 'profileRevision'::text)::bigint
      and observation.status = 'staging'::text
  ) then jsonb_build_object('outcome'::text, 'started'::text)
    else jsonb_build_object('outcome'::text, 'obsolete'::text) end as outcome;
end;

create function eve_module_market.persist_stage_market_page(input jsonb)
returns jsonb
language sql
volatile
parallel unsafe
begin atomic
  insert into market_observation_pages (
    observation_id, page, expected_pages, validated_at, fresh_until, row_count
  )
  select
    observation.observation_id,
    (input ->> 'page'::text)::integer,
    observation.expected_pages,
    (input ->> 'validatedAt'::text)::timestamptz,
    (input ->> 'freshUntil'::text)::timestamptz,
    jsonb_array_length(input -> 'orders'::text)
  from market_observations as observation
  join market_profiles as profile on profile.profile_id = observation.profile_id
  where observation.observation_id = (input ->> 'observationId'::text)::uuid
    and observation.status = 'staging'::text
    and profile.enabled
    and profile.revision = observation.profile_revision
    and observation.expected_pages = (input ->> 'expectedPages'::text)::integer
    and (input ->> 'page'::text)::integer >= 1
    and (input ->> 'page'::text)::integer <= observation.expected_pages
  on conflict (observation_id, page) do nothing;

  insert into market_observation_orders (
    observation_id, order_id, type_id, location_id, system_id,
    side, price, volume_remain, issued_at, duration_days,
    minimum_volume, order_range
  )
  select
    (input ->> 'observationId'::text)::uuid,
    item."orderId", item."typeId", item."locationId", item."solarSystemId",
    item.side, item.price, item."volumeRemain", item."issuedAt",
    item."durationDays", item."minimumVolume", item.range
  from jsonb_to_recordset(input -> 'orders'::text) as item (
    "orderId" bigint, "typeId" bigint, "locationId" bigint, "solarSystemId" bigint,
    side text, price numeric(20, 2), "volumeRemain" bigint, "issuedAt" pg_catalog.timestamptz,
    "durationDays" integer, "minimumVolume" bigint, range text
  )
  where exists (
    select 1 from market_observation_pages as page
    join market_observations as observation
      on observation.observation_id = page.observation_id
    join market_profiles as profile
      on profile.profile_id = observation.profile_id
    where page.observation_id = (input ->> 'observationId'::text)::uuid
      and page.page = (input ->> 'page'::text)::integer
      and page.validated_at = (input ->> 'validatedAt'::text)::timestamptz
      and observation.status = 'staging'::text
      and profile.enabled
      and profile.revision = observation.profile_revision
  )
  on conflict (observation_id, order_id) do nothing;

  select case when exists (
    select 1 from market_observation_pages as page
    join market_observations as observation
      on observation.observation_id = page.observation_id
    join market_profiles as profile
      on profile.profile_id = observation.profile_id
    where page.observation_id = (input ->> 'observationId'::text)::uuid
      and page.page = (input ->> 'page'::text)::integer
      and page.validated_at = (input ->> 'validatedAt'::text)::timestamptz
      and observation.status = 'staging'::text
      and profile.enabled
      and profile.revision = observation.profile_revision
  ) then jsonb_build_object('outcome'::text, 'staged'::text)
    else jsonb_build_object('outcome'::text, 'obsolete'::text) end as outcome;
end;

create function eve_module_market.persist_record_market_failure(input jsonb)
returns jsonb
language sql
volatile
parallel unsafe
begin atomic
  update market_profiles as profile
  set last_failure_class = input ->> 'failureClass'::text,
      next_due_at = (input ->> 'retryAt'::text)::timestamptz,
      last_failure_id = (input ->> 'failureId'::text)::uuid,
      updated_at = now()
  where profile.profile_id = (input ->> 'profileId'::text)::uuid
    and profile.revision = (input ->> 'expectedRevision'::text)::bigint
    and profile.enabled;

  select case when exists (
    select 1 from market_profiles as profile
    where profile.profile_id = (input ->> 'profileId'::text)::uuid
      and profile.revision = (input ->> 'expectedRevision'::text)::bigint
      and profile.last_failure_id = (input ->> 'failureId'::text)::uuid
  ) then jsonb_build_object('outcome'::text, 'recorded'::text)
    else jsonb_build_object('outcome'::text, 'obsolete'::text) end as outcome;
end;

create function eve_module_market.persist_cleanup_market_observations(input jsonb)
returns jsonb
language sql
volatile
parallel unsafe
begin atomic
  delete from market_observations as observation
  where observation.observation_id in (
    select candidate.observation_id
    from market_observations as candidate
    left join market_current_observations as pointer
      on pointer.observation_id = candidate.observation_id
    where pointer.observation_id is null
      and candidate.started_at < (input ->> 'now'::text)::timestamptz - interval '00:15:00'
    order by candidate.started_at, candidate.observation_id
    limit 1
  );

  delete from market_derived_metrics as metrics
  where (metrics.observation_id, metrics.type_id, metrics.derivation_version) in (
    select expired.observation_id, expired.type_id, expired.derivation_version
    from market_derived_metrics as expired
    where expired.observed_at < (input ->> 'now'::text)::timestamptz - interval '30 days'
    order by expired.observed_at, expired.observation_id
    limit 5000
  );

  delete from market_daily_history as history
  where (history.region_id, history.type_id, history.day) in (
    select expired.region_id, expired.type_id, expired.day
    from market_daily_history as expired
    where expired.day < ((input ->> 'now'::text)::timestamptz - interval '1 year')::date
    order by expired.day, expired.region_id, expired.type_id
    limit 5000
  );

  delete from market_reference_prices as prices
  where (prices.type_id, prices.observed_hour) in (
    select expired.type_id, expired.observed_hour
    from market_reference_prices as expired
    where expired.observed_hour < (input ->> 'now'::text)::timestamptz - interval '30 days'
    order by expired.observed_hour, expired.type_id
    limit 5000
  );

  select jsonb_build_object('outcome'::text, 'checked'::text);
end;

create function eve_module_market.persist_read_market_observation(input jsonb)
returns jsonb
language sql
stable
parallel unsafe
return (
  select jsonb_build_object(
    'observationId'::text, observation.observation_id,
    'profileId'::text, observation.profile_id,
    'regionId'::text, observation.region_id,
    'typeId'::text, (input ->> 'typeId'::text)::bigint,
    'observedAt'::text, observation.observed_at,
    'validatedAt'::text, observation.latest_validated_at,
    'freshUntil'::text, observation.fresh_until,
    'expectedPages'::text, observation.expected_pages,
    'totalBookOrders'::text, observation.order_count
  )
  from market_profiles as profile
  join market_observations as observation
    on observation.profile_id = profile.profile_id
    and observation.profile_revision = profile.revision
    and observation.status = 'complete'::text
  left join market_current_observations as pointer
    on pointer.observation_id = observation.observation_id
  where profile.profile_id = (input ->> 'profileId'::text)::uuid
    and profile.enabled
    and (observation.type_id is null
      or observation.type_id = (input ->> 'typeId'::text)::bigint)
    and (
      ((input ->> 'observationId'::text) is null and pointer.observation_id is not null)
      or observation.observation_id = (input ->> 'observationId'::text)::uuid
    )
  order by observation.observed_at desc, observation.observation_id desc
  limit 1
);

create function eve_module_market.persist_read_market_order_rows(input jsonb)
returns jsonb
language sql
stable
parallel unsafe
return (
  with eligible as (
    select
      market_order.observation_id,
      market_order.order_id,
      market_order.type_id,
      market_order.location_id,
      market_order.system_id,
      market_order.side,
      market_order.price,
      market_order.volume_remain,
      market_order.issued_at,
      market_order.duration_days,
      market_order.minimum_volume,
      market_order.order_range
    from market_observation_orders as market_order
    join market_observations as observation
      on observation.observation_id = market_order.observation_id
    join market_profiles as profile
      on profile.profile_id = observation.profile_id
      and profile.revision = observation.profile_revision
    where observation.observation_id = (input ->> 'observationId'::text)::uuid
      and observation.status = 'complete'::text
      and profile.enabled
      and market_order.type_id = (input ->> 'typeId'::text)::bigint
      and market_order.side = input ->> 'side'::text
      and (
        (input ->> 'cursorPrice'::text) is null
        or (market_order.side = 'sell'::text and (
          market_order.price > (input ->> 'cursorPrice'::text)::numeric
          or (market_order.price = (input ->> 'cursorPrice'::text)::numeric
            and row(market_order.issued_at, market_order.order_id) > row(
              (input ->> 'cursorIssuedAt'::text)::timestamptz,
              (input ->> 'cursorOrderId'::text)::bigint
            ))
        ))
        or (market_order.side = 'buy'::text and (
          market_order.price < (input ->> 'cursorPrice'::text)::numeric
          or (market_order.price = (input ->> 'cursorPrice'::text)::numeric
            and row(market_order.issued_at, market_order.order_id) > row(
              (input ->> 'cursorIssuedAt'::text)::timestamptz,
              (input ->> 'cursorOrderId'::text)::bigint
            ))
        ))
      )
    order by
      case when market_order.side = 'sell'::text then market_order.price else null::numeric end,
      case when market_order.side = 'buy'::text then market_order.price else null::numeric end desc,
      market_order.issued_at,
      market_order.order_id
    limit (input ->> 'limit'::text)::integer + 1
  ), visible as (
    select
      eligible.observation_id,
      eligible.order_id,
      eligible.type_id,
      eligible.location_id,
      eligible.system_id,
      eligible.side,
      eligible.price,
      eligible.volume_remain,
      eligible.issued_at,
      eligible.duration_days,
      eligible.minimum_volume,
      eligible.order_range
    from eligible
    order by
      case when eligible.side = 'sell'::text then eligible.price else null::numeric end,
      case when eligible.side = 'buy'::text then eligible.price else null::numeric end desc,
      eligible.issued_at,
      eligible.order_id
    limit (input ->> 'limit'::text)::integer
  )
  select jsonb_build_object(
    'rows'::text,
    coalesce(jsonb_agg(jsonb_build_object(
      'orderId'::text, visible.order_id,
      'side'::text, visible.side,
      'price'::text, visible.price::text,
      'volumeRemain'::text, visible.volume_remain,
      'locationId'::text, visible.location_id,
      'solarSystemId'::text, visible.system_id,
      'issuedAt'::text, visible.issued_at,
      'durationDays'::text, visible.duration_days,
      'minimumVolume'::text, visible.minimum_volume,
      'range'::text, visible.order_range
    ) order by
      case when visible.side = 'sell'::text then visible.price else null::numeric end,
      case when visible.side = 'buy'::text then visible.price else null::numeric end desc,
      visible.issued_at,
      visible.order_id
    ), '[]'::jsonb),
    'hasMore'::text,
    (select count(*) > (input ->> 'limit'::text)::integer from eligible)
  ) from visible
);

create function eve_module_market.persist_upsert_market_reference_prices(input jsonb)
returns jsonb
language sql
volatile
parallel unsafe
begin atomic
  insert into market_reference_prices (
    type_id, observed_hour, adjusted_price, average_price, validated_at
  )
  select
    item."typeId",
    (input ->> 'observedHour'::text)::timestamptz,
    item."adjustedPriceIsk",
    item."averagePriceIsk",
    (input ->> 'validatedAt'::text)::timestamptz
  from jsonb_to_recordset(input -> 'prices'::text) as item (
    "typeId" bigint,
    "adjustedPriceIsk" numeric(20, 2),
    "averagePriceIsk" numeric(20, 2)
  )
  where date_trunc('hour'::text, (input ->> 'observedHour'::text)::timestamptz) =
    (input ->> 'observedHour'::text)::timestamptz
  on conflict (type_id, observed_hour) do update
  set adjusted_price = excluded.adjusted_price,
      average_price = excluded.average_price,
      validated_at = excluded.validated_at
  where market_reference_prices.validated_at <= excluded.validated_at;

  select jsonb_build_object('outcome'::text, 'applied'::text);
end;

create function eve_module_market.persist_read_market_reference_prices(input jsonb)
returns jsonb
language sql
stable
parallel unsafe
return (
  select coalesce(jsonb_agg(jsonb_build_object(
    'typeId'::text, latest.type_id,
    'adjustedPriceIsk'::text, latest.adjusted_price::text,
    'averagePriceIsk'::text, latest.average_price::text,
    'sourceHour'::text, latest.observed_hour,
    'validatedAt'::text, latest.validated_at
  ) order by latest.type_id), '[]'::jsonb)
  from (
    select distinct on (prices.type_id)
      prices.type_id,
      prices.adjusted_price,
      prices.average_price,
      prices.observed_hour,
      prices.validated_at
    from market_reference_prices as prices
    where prices.type_id in (
      select requested.value::bigint
      from jsonb_array_elements_text(input -> 'typeIds'::text) as requested(value)
    )
    order by prices.type_id, prices.observed_hour desc
    limit 100
  ) as latest
);

create function eve_module_market.persist_list_due_market_history_profiles(input jsonb)
returns jsonb
language sql
stable
parallel unsafe
return (
  with subjects as (
    select profile.profile_id, profile.revision, profile.region_id,
      requested.value::bigint as type_id
    from market_profiles as profile
    cross join lateral jsonb_array_elements_text(profile.watched_type_ids) as requested(value)
    where profile.enabled and profile.mode = 'watched-types'::text
    union all
    select profile.profile_id, profile.revision, profile.region_id, demand.type_id
    from market_profiles as profile
    join market_history_demands as demand on demand.profile_id = profile.profile_id
      and demand.profile_revision = profile.revision
    where profile.enabled and profile.mode = 'region'::text
  ), due as (
    select subject.profile_id, subject.revision,
      coalesce(state.next_due_at, '1970-01-01 00:00:00+00'::timestamptz) as next_due_at
    from subjects as subject
    left join market_history_collection_state as state
      on state.profile_id = subject.profile_id and state.type_id = subject.type_id
      and state.profile_revision = subject.revision
    left join market_history_profile_failures as failure
      on failure.profile_id = subject.profile_id and failure.profile_revision = subject.revision
    where (state.profile_id is null or (state.next_due_at is not null
        and state.next_due_at <= (input ->> 'now'::text)::timestamptz))
      and (failure.profile_id is null or (failure.next_allowed_at is not null
        and failure.next_allowed_at <= (input ->> 'now'::text)::timestamptz))
  ), bounded as (
    select due.profile_id, due.revision, min(due.next_due_at) as next_due_at
    from due
    group by due.profile_id, due.revision
    order by min(due.next_due_at), due.profile_id
    limit 16
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'profileId'::text, bounded.profile_id,
    'revision'::text, bounded.revision,
    'nextDueAt'::text, bounded.next_due_at
  ) order by bounded.next_due_at, bounded.profile_id), '[]'::jsonb)
  from bounded
);

create function eve_module_market.persist_list_due_market_history_types(input jsonb)
returns jsonb
language sql
stable
parallel unsafe
return (
  with subjects as (
    select profile.profile_id, profile.revision, profile.region_id,
      requested.value::bigint as type_id
    from market_profiles as profile
    cross join lateral jsonb_array_elements_text(profile.watched_type_ids) as requested(value)
    where profile.enabled and profile.mode = 'watched-types'::text
    union all
    select profile.profile_id, profile.revision, profile.region_id, demand.type_id
    from market_profiles as profile
    join market_history_demands as demand on demand.profile_id = profile.profile_id
      and demand.profile_revision = profile.revision
    where profile.enabled and profile.mode = 'region'::text
  ), due as (
    select subject.region_id, subject.type_id,
      coalesce(state.next_due_at, '1970-01-01 00:00:00+00'::timestamptz) as next_due_at
    from subjects as subject
    left join market_history_collection_state as state
      on state.profile_id = subject.profile_id and state.type_id = subject.type_id
      and state.profile_revision = subject.revision
    left join market_history_profile_failures as failure
      on failure.profile_id = subject.profile_id and failure.profile_revision = subject.revision
    where subject.profile_id = (input ->> 'profileId'::text)::uuid
      and subject.revision = (input ->> 'expectedRevision'::text)::bigint
      and (input ->> 'typeId'::text is null
        or subject.type_id = (input ->> 'typeId'::text)::bigint)
      and (state.profile_id is null or (state.next_due_at is not null
        and state.next_due_at <= (input ->> 'now'::text)::timestamptz))
      and (failure.profile_id is null or (failure.next_allowed_at is not null
        and failure.next_allowed_at <= (input ->> 'now'::text)::timestamptz))
    order by coalesce(state.next_due_at, '1970-01-01 00:00:00+00'::timestamptz), subject.type_id
    limit 16
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'regionId'::text, due.region_id,
    'typeId'::text, due.type_id,
    'nextDueAt'::text, due.next_due_at
  ) order by due.next_due_at, due.type_id), '[]'::jsonb)
  from due
);

create function eve_module_market.persist_upsert_market_history(input jsonb)
returns jsonb
language sql
volatile
parallel unsafe
begin atomic
  insert into market_history_collection_state (
    profile_id, type_id, profile_revision, next_due_at,
    validated_at, fresh_until, last_failure_class, last_attempt_id
  )
  select profile.profile_id,
    (input ->> 'typeId'::text)::bigint,
    profile.revision,
    (input ->> 'freshUntil'::text)::timestamptz,
    (input ->> 'validatedAt'::text)::timestamptz,
    (input ->> 'freshUntil'::text)::timestamptz,
    null::text,
    (input ->> 'attemptId'::text)::uuid
  from market_profiles as profile
  where profile.profile_id = (input ->> 'profileId'::text)::uuid
    and profile.revision = (input ->> 'expectedRevision'::text)::bigint
    and profile.region_id = (input ->> 'regionId'::text)::bigint
    and profile.enabled
    and (
      profile.watched_type_ids @> jsonb_build_array((input ->> 'typeId'::text)::bigint)
      or exists (select 1 from market_history_demands as demand
        where demand.profile_id = profile.profile_id
          and demand.profile_revision = profile.revision
          and demand.type_id = (input ->> 'typeId'::text)::bigint)
    )
  on conflict (profile_id, type_id) do update
  set profile_revision = excluded.profile_revision,
      next_due_at = excluded.next_due_at,
      validated_at = excluded.validated_at,
      fresh_until = excluded.fresh_until,
      last_failure_class = null::text,
      last_attempt_id = excluded.last_attempt_id
  where market_history_collection_state.profile_revision < excluded.profile_revision
    or (market_history_collection_state.profile_revision = excluded.profile_revision
      and (market_history_collection_state.validated_at is null
        or market_history_collection_state.validated_at <= excluded.validated_at));

  insert into market_daily_history (
    region_id, type_id, day, average, highest, lowest,
    volume, order_count, validated_at
  )
  select
    (input ->> 'regionId'::text)::bigint,
    (input ->> 'typeId'::text)::bigint,
    record.date,
    record."averageIsk",
    record."highIsk",
    record."lowIsk",
    record.volume,
    record."orderCount",
    (input ->> 'validatedAt'::text)::timestamptz
  from jsonb_to_recordset(input -> 'days'::text) as record (
    date date,
    "averageIsk" numeric(20, 2),
    "highIsk" numeric(20, 2),
    "lowIsk" numeric(20, 2),
    volume bigint,
    "orderCount" bigint
  )
  where exists (
    select 1 from market_history_collection_state as state
    join market_profiles as profile on profile.profile_id = state.profile_id
    where state.profile_id = (input ->> 'profileId'::text)::uuid
      and state.type_id = (input ->> 'typeId'::text)::bigint
      and state.profile_revision = profile.revision
      and state.last_attempt_id = (input ->> 'attemptId'::text)::uuid
      and profile.enabled
  )
  on conflict (region_id, type_id, day) do update
  set average = excluded.average,
      highest = excluded.highest,
      lowest = excluded.lowest,
      volume = excluded.volume,
      order_count = excluded.order_count,
      validated_at = excluded.validated_at
  where market_daily_history.validated_at <= excluded.validated_at;

  delete from market_history_profile_failures as failure
  where failure.profile_id = (input ->> 'profileId'::text)::uuid
    and failure.profile_revision = (input ->> 'expectedRevision'::text)::bigint
    and exists (
      select 1 from market_history_collection_state as state
      where state.profile_id = failure.profile_id
        and state.type_id = (input ->> 'typeId'::text)::bigint
        and state.last_attempt_id = (input ->> 'attemptId'::text)::uuid
    );

  select case when exists (
    select 1 from market_history_collection_state as state
    where state.profile_id = (input ->> 'profileId'::text)::uuid
      and state.type_id = (input ->> 'typeId'::text)::bigint
      and state.profile_revision = (input ->> 'expectedRevision'::text)::bigint
      and state.last_attempt_id = (input ->> 'attemptId'::text)::uuid
  ) then jsonb_build_object('outcome'::text, 'applied'::text)
    else jsonb_build_object('outcome'::text, 'obsolete'::text) end as outcome;
end;

create function eve_module_market.persist_record_market_history_failure(input jsonb)
returns jsonb
language sql
volatile
parallel unsafe
begin atomic
  insert into market_history_profile_failures (
    profile_id, profile_revision, next_allowed_at,
    last_failure_class, last_failure_id
  )
  select profile.profile_id,
    profile.revision,
    (input ->> 'retryAt'::text)::timestamptz,
    input ->> 'failureClass'::text,
    (input ->> 'failureId'::text)::uuid
  from market_profiles as profile
  where input ->> 'typeId'::text is null
    and profile.profile_id = (input ->> 'profileId'::text)::uuid
    and profile.revision = (input ->> 'expectedRevision'::text)::bigint
    and profile.enabled
  on conflict (profile_id) do update
  set profile_revision = excluded.profile_revision,
      next_allowed_at = excluded.next_allowed_at,
      last_failure_class = excluded.last_failure_class,
      last_failure_id = excluded.last_failure_id
  where market_history_profile_failures.profile_revision <= excluded.profile_revision;

  insert into market_history_collection_state (
    profile_id, type_id, profile_revision, next_due_at,
    validated_at, fresh_until, last_failure_class, last_attempt_id
  )
  select profile.profile_id,
    (input ->> 'typeId'::text)::bigint,
    profile.revision,
    (input ->> 'retryAt'::text)::timestamptz,
    null::timestamptz,
    null::timestamptz,
    input ->> 'failureClass'::text,
    (input ->> 'failureId'::text)::uuid
  from market_profiles as profile
  where input ->> 'typeId'::text is not null
    and profile.profile_id = (input ->> 'profileId'::text)::uuid
    and profile.revision = (input ->> 'expectedRevision'::text)::bigint
    and profile.enabled
  on conflict (profile_id, type_id) do update
  set profile_revision = excluded.profile_revision,
      next_due_at = excluded.next_due_at,
      validated_at = case
        when market_history_collection_state.profile_revision = excluded.profile_revision
          then market_history_collection_state.validated_at
        else null::timestamptz
        end,
      fresh_until = case
        when market_history_collection_state.profile_revision = excluded.profile_revision
          then market_history_collection_state.fresh_until
        else null::timestamptz
        end,
      last_failure_class = excluded.last_failure_class,
      last_attempt_id = excluded.last_attempt_id
  where market_history_collection_state.profile_revision <= excluded.profile_revision;

  select case when exists (
    select 1 from market_history_profile_failures as failure
    where input ->> 'typeId'::text is null
      and failure.profile_id = (input ->> 'profileId'::text)::uuid
      and failure.profile_revision = (input ->> 'expectedRevision'::text)::bigint
      and failure.last_failure_id = (input ->> 'failureId'::text)::uuid
  ) or exists (
    select 1 from market_history_collection_state as state
    where state.profile_id = (input ->> 'profileId'::text)::uuid
      and state.type_id = (input ->> 'typeId'::text)::bigint
      and state.profile_revision = (input ->> 'expectedRevision'::text)::bigint
      and state.last_attempt_id = (input ->> 'failureId'::text)::uuid
  ) then jsonb_build_object('outcome'::text, 'recorded'::text)
    else jsonb_build_object('outcome'::text, 'obsolete'::text) end as outcome;
end;

create function eve_module_market.persist_read_market_history(input jsonb)
returns jsonb
language sql
stable
parallel unsafe
return (
  select jsonb_build_object(
    'status'::text, case when state.validated_at is null then 'uncollected'::text
      else 'observed'::text end,
    'regionId'::text, profile.region_id,
    'typeId'::text, (input ->> 'typeId'::text)::bigint,
    'validatedAt'::text, state.validated_at,
    'freshUntil'::text, state.fresh_until,
    'days'::text, case when state.validated_at is null then '[]'::jsonb
      else (select coalesce(jsonb_agg(jsonb_build_object(
        'date'::text, latest.day,
        'averageIsk'::text, latest.average::text,
        'highIsk'::text, latest.highest::text,
        'lowIsk'::text, latest.lowest::text,
        'volume'::text, latest.volume,
        'orderCount'::text, latest.order_count
      ) order by latest.day), '[]'::jsonb)
      from (
        select history.day, history.average, history.highest,
          history.lowest, history.volume, history.order_count
        from market_daily_history as history
        where history.region_id = profile.region_id
          and history.type_id = (input ->> 'typeId'::text)::bigint
        order by history.day desc
        limit 365
      ) as latest) end
  )
  from market_profiles as profile
  left join market_history_collection_state as state
    on state.profile_id = profile.profile_id
      and state.profile_revision = profile.revision
      and state.type_id = (input ->> 'typeId'::text)::bigint
  where profile.profile_id = (input ->> 'profileId'::text)::uuid
    and profile.enabled
    and (
      profile.watched_type_ids @> jsonb_build_array((input ->> 'typeId'::text)::bigint)
      or exists (select 1 from market_history_demands as demand
        where demand.profile_id = profile.profile_id
          and demand.profile_revision = profile.revision
          and demand.type_id = (input ->> 'typeId'::text)::bigint)
    )
  limit 1
);

create function eve_module_market.persist_list_market_derivation_types(input jsonb)
returns jsonb
language sql
stable
parallel unsafe
return (
  select coalesce(jsonb_agg(types.type_id order by types.type_id + 0::bigint), '[]'::jsonb)
  from (
    select requested.value::bigint as type_id
    from market_profiles as profile
    cross join lateral jsonb_array_elements_text(profile.watched_type_ids) as requested(value)
    where profile.profile_id = (input ->> 'profileId'::text)::uuid
      and profile.revision = (input ->> 'expectedRevision'::text)::bigint
      and profile.enabled
      and profile.mode = 'watched-types'::text
    union
    select demand.type_id
    from market_history_demands as demand
    join market_profiles as profile on profile.profile_id = demand.profile_id
    where profile.profile_id = (input ->> 'profileId'::text)::uuid
      and profile.revision = (input ->> 'expectedRevision'::text)::bigint
      and profile.enabled
      and profile.mode = 'region'::text
      and demand.profile_revision = profile.revision
    order by 1
    limit 16
  ) as types
);

create function eve_module_market.persist_store_market_metrics(input jsonb)
returns jsonb
language sql
volatile
parallel unsafe
begin atomic
  insert into market_derived_metrics (
    observation_id, type_id, derivation_version, metrics, observed_at,
    profile_id, profile_revision, region_id
  )
  select observation.observation_id,
    (input ->> 'typeId'::text)::bigint,
    (input ->> 'derivationVersion'::text)::integer,
    input -> 'metrics'::text,
    observation.observed_at,
    observation.profile_id,
    observation.profile_revision,
    observation.region_id
  from market_observations as observation
  join market_profiles as profile on profile.profile_id = observation.profile_id
    and profile.revision = observation.profile_revision and profile.enabled
  join market_current_observations as pointer
    on pointer.observation_id = observation.observation_id
  where observation.observation_id = (input ->> 'observationId'::text)::uuid
    and observation.status = 'complete'::text
    and (observation.type_id is null
      or observation.type_id = (input ->> 'typeId'::text)::bigint)
  on conflict (observation_id, type_id, derivation_version) do nothing;

  select case when exists (
    select 1 from market_derived_metrics as metrics
    where metrics.observation_id = (input ->> 'observationId'::text)::uuid
      and metrics.type_id = (input ->> 'typeId'::text)::bigint
      and metrics.derivation_version = (input ->> 'derivationVersion'::text)::integer
  ) then jsonb_build_object('outcome'::text, 'stored'::text)
    else jsonb_build_object('outcome'::text, 'obsolete'::text) end as outcome;
end;

create function eve_module_market.persist_read_market_metrics(input jsonb)
returns jsonb
language sql
stable
parallel unsafe
return (
  select jsonb_build_object(
    'availableFrom'::text,
    (select min(metrics.observed_at) from market_derived_metrics as metrics
      where metrics.profile_id = profile.profile_id
        and metrics.profile_revision = profile.revision
        and metrics.type_id = (input ->> 'typeId'::text)::bigint),
    'availableThrough'::text,
    (select max(metrics.observed_at) from market_derived_metrics as metrics
      where metrics.profile_id = profile.profile_id
        and metrics.profile_revision = profile.revision
        and metrics.type_id = (input ->> 'typeId'::text)::bigint),
    'items'::text,
    (select coalesce(jsonb_agg(jsonb_build_object(
      'observationId'::text, recent.observation_id,
      'observedAt'::text, recent.observed_at,
      'derivationVersion'::text, recent.derivation_version,
      'metrics'::text, recent.metrics
    ) order by recent.observed_at desc, recent.observation_id desc), '[]'::jsonb)
    from (
      select metrics.observation_id, metrics.observed_at,
        metrics.derivation_version, metrics.metrics
      from market_derived_metrics as metrics
      where metrics.profile_id = profile.profile_id
        and metrics.profile_revision = profile.revision
        and metrics.type_id = (input ->> 'typeId'::text)::bigint
        and ((input ->> 'beforeObservedAt'::text) is null
          or row(metrics.observed_at, metrics.observation_id) < row(
            (input ->> 'beforeObservedAt'::text)::timestamptz,
            (input ->> 'beforeObservationId'::text)::uuid))
      order by metrics.observed_at desc, metrics.observation_id desc
      limit 100
    ) as recent)
  )
  from market_profiles as profile
  where profile.profile_id = (input ->> 'profileId'::text)::uuid
    and profile.enabled
  limit 1
);

create function eve_module_market.persist_cleanup_market_history_demands(input jsonb)
returns jsonb
language sql
volatile
parallel unsafe
begin atomic
  delete from market_history_demands as demand
  where (demand.profile_id, demand.type_id) in (
    select expired.profile_id, expired.type_id
    from market_history_demands as expired
    join market_profiles as profile on profile.profile_id = expired.profile_id
    where expired.profile_revision <> profile.revision
      or expired.requested_at < (input ->> 'now'::text)::timestamptz - interval '30 days'
    order by expired.requested_at, expired.profile_id, expired.type_id
    limit 5000
  );

  delete from market_history_collection_state as state
  where (state.profile_id, state.type_id) in (
    select expired.profile_id, expired.type_id
    from market_history_collection_state as expired
    join market_profiles as profile on profile.profile_id = expired.profile_id
    where expired.profile_revision <> profile.revision
    order by expired.profile_id, expired.type_id
    limit 5000
  );

  delete from market_history_profile_failures as failure
  where failure.profile_id in (
    select expired.profile_id
    from market_history_profile_failures as expired
    join market_profiles as profile on profile.profile_id = expired.profile_id
    where expired.profile_revision <> profile.revision
    order by expired.profile_id
    limit 5000
  );

  select jsonb_build_object('outcome'::text, 'checked'::text);
end;

create function eve_module_market.persist_begin_structure_observation(input jsonb)
returns jsonb
language sql
volatile
parallel unsafe
begin atomic
  insert into market_structure_observations (
    observation_id, character_id, subject_lifecycle_id,
    authorization_generation, organization_version, structure_id, expected_pages, status, started_at
  ) values (
    (input ->> 'observationId'::text)::uuid,
    (input ->> 'characterId'::text)::bigint,
    (input ->> 'subjectLifecycleId'::text)::uuid,
    (input ->> 'authorizationGeneration'::text)::integer,
    (input ->> 'organizationVersion'::text)::bigint,
    (input ->> 'structureId'::text)::bigint,
    (input ->> 'expectedPages'::text)::integer,
    'staging'::text,
    (input ->> 'startedAt'::text)::timestamptz
  ) on conflict (observation_id) do nothing;

  select case when exists (
    select 1 from market_structure_observations as observation
    where observation.observation_id = (input ->> 'observationId'::text)::uuid
      and observation.status = 'staging'::text
  ) then jsonb_build_object('outcome'::text, 'started'::text)
    else jsonb_build_object('outcome'::text, 'obsolete'::text) end as outcome;
end;

create function eve_module_market.persist_stage_structure_page(input jsonb)
returns jsonb
language sql
volatile
parallel unsafe
begin atomic
  insert into market_structure_pages (
    observation_id, page, expected_pages, validated_at, fresh_until, row_count
  )
  select observation.observation_id,
    (input ->> 'page'::text)::integer,
    observation.expected_pages,
    (input ->> 'validatedAt'::text)::timestamptz,
    (input ->> 'freshUntil'::text)::timestamptz,
    jsonb_array_length(input -> 'orders'::text)
  from market_structure_observations as observation
  where observation.observation_id = (input ->> 'observationId'::text)::uuid
    and observation.status = 'staging'::text
    and observation.expected_pages = (input ->> 'expectedPages'::text)::integer
    and (input ->> 'page'::text)::integer >= 1
    and (input ->> 'page'::text)::integer <= observation.expected_pages
  on conflict (observation_id, page) do nothing;

  insert into market_structure_orders (
    observation_id, order_id, type_id, location_id, side,
    price, volume_remain, issued_at, duration_days, minimum_volume, order_range
  )
  select observation.observation_id,
    item."orderId", item."typeId", item."locationId", item.side,
    item.price, item."volumeRemain", item."issuedAt", item."durationDays",
    item."minimumVolume", item.range
  from market_structure_observations as observation
  join market_structure_pages as page on page.observation_id = observation.observation_id
  cross join lateral jsonb_to_recordset(input -> 'orders'::text) as item (
    "orderId" bigint, "typeId" bigint, "locationId" bigint,
    side text, price numeric(20, 2), "volumeRemain" bigint,
    "issuedAt" pg_catalog.timestamptz, "durationDays" integer,
    "minimumVolume" bigint, range text
  )
  where observation.observation_id = (input ->> 'observationId'::text)::uuid
    and observation.status = 'staging'::text
    and page.page = (input ->> 'page'::text)::integer
    and page.validated_at = (input ->> 'validatedAt'::text)::timestamptz
    and item."locationId" = observation.structure_id
  on conflict (observation_id, order_id) do nothing;

  select case when exists (
    select 1 from market_structure_pages as page
    where page.observation_id = (input ->> 'observationId'::text)::uuid
      and page.page = (input ->> 'page'::text)::integer
      and page.validated_at = (input ->> 'validatedAt'::text)::timestamptz
  ) then jsonb_build_object('outcome'::text, 'staged'::text)
    else jsonb_build_object('outcome'::text, 'obsolete'::text) end as outcome;
end;

create function eve_module_market.persist_publish_structure_observation(input jsonb)
returns jsonb
language sql
volatile
parallel unsafe
begin atomic
  update market_structure_observations as observation
  set status = 'complete'::text,
    observed_at = (select min(page.validated_at) from market_structure_pages as page
      where page.observation_id = observation.observation_id),
    validated_at = (select max(page.validated_at) from market_structure_pages as page
      where page.observation_id = observation.observation_id),
    fresh_until = (select min(page.fresh_until) from market_structure_pages as page
      where page.observation_id = observation.observation_id),
    order_count = (select count(*)::integer from market_structure_orders as market_order
      where market_order.observation_id = observation.observation_id)
  where observation.observation_id = (input ->> 'observationId'::text)::uuid
    and observation.status = 'staging'::text
    and (select count(*) from market_structure_pages as page
      where page.observation_id = observation.observation_id) = observation.expected_pages
    and (select count(*) from market_structure_orders as market_order
      where market_order.observation_id = observation.observation_id) =
      (select sum(page.row_count) from market_structure_pages as page
        where page.observation_id = observation.observation_id)
    and (select count(*) from market_structure_orders as market_order
      where market_order.observation_id = observation.observation_id) <= 32000
    and (select max(page.validated_at) - min(page.validated_at)
      from market_structure_pages as page
      where page.observation_id = observation.observation_id) <= interval '00:01:00'
    and (select min(page.fresh_until) from market_structure_pages as page
      where page.observation_id = observation.observation_id) > now()
    and not exists (
      select 1 from market_structure_pages as page
      where page.observation_id = observation.observation_id
        and (page.expected_pages <> observation.expected_pages
          or page.fresh_until <= page.validated_at)
    );

  insert into market_structure_current (
    character_id, subject_lifecycle_id, authorization_generation,
    structure_id, observation_id, observed_at
  )
  select observation.character_id, observation.subject_lifecycle_id,
    observation.authorization_generation, observation.structure_id,
    observation.observation_id, observation.observed_at
  from market_structure_observations as observation
  where observation.observation_id = (input ->> 'observationId'::text)::uuid
    and observation.status = 'complete'::text
  on conflict (character_id, subject_lifecycle_id, authorization_generation, structure_id)
    do update set observation_id = excluded.observation_id,
      observed_at = excluded.observed_at
    where market_structure_current.observed_at < excluded.observed_at;

  select case when exists (
    select 1 from market_structure_current as pointer
    where pointer.observation_id = (input ->> 'observationId'::text)::uuid
  ) then jsonb_build_object('outcome'::text, 'published'::text)
    else jsonb_build_object('outcome'::text, 'incomplete'::text) end as outcome;
end;

create function eve_module_market.persist_read_structure_book(input jsonb)
returns jsonb
language sql
stable
parallel unsafe
return (
  select jsonb_build_object(
    'observationId'::text, observation.observation_id,
    'structureId'::text, observation.structure_id,
    'typeId'::text, (input ->> 'typeId'::text)::bigint,
    'observedAt'::text, observation.observed_at,
    'validatedAt'::text, observation.validated_at,
    'freshUntil'::text, observation.fresh_until,
    'expectedPages'::text, observation.expected_pages,
    'totalBookOrders'::text, observation.order_count,
    'rows'::text, (
      select coalesce(jsonb_agg(jsonb_build_object(
        'orderId'::text, item.order_id,
        'side'::text, item.side,
        'price'::text, item.price::text,
        'volumeRemain'::text, item.volume_remain,
        'locationId'::text, item.location_id,
        'issuedAt'::text, item.issued_at,
        'durationDays'::text, item.duration_days,
        'minimumVolume'::text, item.minimum_volume,
        'range'::text, item.order_range
      ) order by
        case when item.side = 'sell'::text then item.price else null::numeric end,
        case when item.side = 'buy'::text then item.price else null::numeric end desc,
        item.issued_at, item.order_id
      ), '[]'::jsonb)
      from (
        select market_order.order_id, market_order.side, market_order.price,
          market_order.volume_remain, market_order.location_id, market_order.issued_at,
          market_order.duration_days, market_order.minimum_volume, market_order.order_range
        from market_structure_orders as market_order
        where market_order.observation_id = observation.observation_id
          and market_order.type_id = (input ->> 'typeId'::text)::bigint
          and market_order.side = input ->> 'side'::text
          and (
            (input ->> 'cursorPrice'::text) is null
            or (market_order.side = 'sell'::text and (
              market_order.price > (input ->> 'cursorPrice'::text)::numeric
              or (market_order.price = (input ->> 'cursorPrice'::text)::numeric
                and row(market_order.issued_at, market_order.order_id) > row(
                  (input ->> 'cursorIssuedAt'::text)::timestamptz,
                  (input ->> 'cursorOrderId'::text)::bigint))
            ))
            or (market_order.side = 'buy'::text and (
              market_order.price < (input ->> 'cursorPrice'::text)::numeric
              or (market_order.price = (input ->> 'cursorPrice'::text)::numeric
                and row(market_order.issued_at, market_order.order_id) > row(
                  (input ->> 'cursorIssuedAt'::text)::timestamptz,
                  (input ->> 'cursorOrderId'::text)::bigint))
            ))
          )
        order by
          case when market_order.side = 'sell'::text then market_order.price else null::numeric end,
          case when market_order.side = 'buy'::text then market_order.price else null::numeric end desc,
          market_order.issued_at, market_order.order_id
        limit (input ->> 'limit'::text)::integer
      ) as item
    )
  )
  from market_structure_current as pointer
  join market_structure_observations as observation
    on observation.observation_id = pointer.observation_id
  where pointer.character_id = (input ->> 'characterId'::text)::bigint
    and pointer.subject_lifecycle_id = (input ->> 'subjectLifecycleId'::text)::uuid
    and pointer.authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
    and pointer.structure_id = (input ->> 'structureId'::text)::bigint
    and observation.organization_version = (input ->> 'organizationVersion'::text)::bigint
    and observation.status = 'complete'::text
  limit 1
);

create function eve_module_market.persist_cleanup_structure_observations(input jsonb)
returns jsonb
language sql
volatile
parallel unsafe
begin atomic
  delete from market_structure_current as pointer
  where (pointer.character_id, pointer.subject_lifecycle_id,
    pointer.authorization_generation, pointer.structure_id) in (
    select expired.character_id, expired.subject_lifecycle_id,
      expired.authorization_generation, expired.structure_id
    from market_structure_current as expired
    where expired.observed_at < (input ->> 'now'::text)::timestamptz - interval '24:00:00'
    order by expired.observed_at, expired.character_id, expired.structure_id
    limit 1
  );

  delete from market_structure_observations as observation
  where observation.observation_id in (
    select expired.observation_id
    from market_structure_observations as expired
    left join market_structure_current as pointer
      on pointer.observation_id = expired.observation_id
    where pointer.observation_id is null
      and expired.started_at < (input ->> 'now'::text)::timestamptz - interval '24:00:00'
    order by expired.started_at, expired.observation_id
    limit 1
  );

  select jsonb_build_object('outcome'::text, 'checked'::text);
end;

create function eve_module_market.persist_reserve_structure_demand(input jsonb)
returns jsonb
language sql
volatile
parallel unsafe
begin atomic
  insert into market_structure_demands (
    character_id, subject_lifecycle_id, authorization_generation,
    organization_version, structure_id, requested_at, last_request_id
  )
  select
    (input ->> 'characterId'::text)::bigint,
    (input ->> 'subjectLifecycleId'::text)::uuid,
    (input ->> 'authorizationGeneration'::text)::integer,
    (input ->> 'organizationVersion'::text)::bigint,
    (input ->> 'structureId'::text)::bigint,
    now(),
    (input ->> 'requestId'::text)::uuid
  from (select capacity.singleton from market_profile_capacity as capacity
    for update of capacity) as guard
  where (
    (select count(*) from market_structure_demands as demand
      where demand.character_id = (input ->> 'characterId'::text)::bigint
        and demand.subject_lifecycle_id = (input ->> 'subjectLifecycleId'::text)::uuid
        and demand.authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
        and demand.organization_version = (input ->> 'organizationVersion'::text)::bigint
        and demand.requested_at > now() - interval '24:00:00') < 4
    or exists (select 1 from market_structure_demands as existing
      where existing.character_id = (input ->> 'characterId'::text)::bigint
        and existing.subject_lifecycle_id = (input ->> 'subjectLifecycleId'::text)::uuid
        and existing.authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
        and existing.organization_version = (input ->> 'organizationVersion'::text)::bigint
        and existing.structure_id = (input ->> 'structureId'::text)::bigint)
  )
  on conflict (character_id, subject_lifecycle_id, authorization_generation,
    organization_version, structure_id) do update
  set requested_at = excluded.requested_at,
      last_request_id = excluded.last_request_id
  where market_structure_demands.requested_at < now() - interval '00:01:00';

  select case
    when exists (select 1 from market_structure_demands as demand
      where demand.character_id = (input ->> 'characterId'::text)::bigint
        and demand.subject_lifecycle_id = (input ->> 'subjectLifecycleId'::text)::uuid
        and demand.authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
        and demand.organization_version = (input ->> 'organizationVersion'::text)::bigint
        and demand.structure_id = (input ->> 'structureId'::text)::bigint
        and demand.last_request_id = (input ->> 'requestId'::text)::uuid)
      then jsonb_build_object('outcome'::text, 'reserved'::text)
    when exists (select 1 from market_structure_demands as demand
      where demand.character_id = (input ->> 'characterId'::text)::bigint
        and demand.subject_lifecycle_id = (input ->> 'subjectLifecycleId'::text)::uuid
        and demand.authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
        and demand.organization_version = (input ->> 'organizationVersion'::text)::bigint
        and demand.structure_id = (input ->> 'structureId'::text)::bigint)
      then jsonb_build_object('outcome'::text, 'recent'::text)
    else jsonb_build_object('outcome'::text, 'full'::text)
  end as outcome;
end;

create function eve_module_market.persist_release_structure_demand(input jsonb)
returns jsonb
language sql
volatile
parallel unsafe
begin atomic
  delete from market_structure_demands as demand
  where demand.character_id = (input ->> 'characterId'::text)::bigint
    and demand.subject_lifecycle_id = (input ->> 'subjectLifecycleId'::text)::uuid
    and demand.authorization_generation = (input ->> 'authorizationGeneration'::text)::integer
    and demand.organization_version = (input ->> 'organizationVersion'::text)::bigint
    and demand.structure_id = (input ->> 'structureId'::text)::bigint
    and demand.last_request_id = (input ->> 'requestId'::text)::uuid;
  select jsonb_build_object('outcome'::text, 'released'::text);
end;

create function eve_module_market.persist_cleanup_structure_demands(input jsonb)
returns jsonb
language sql
volatile
parallel unsafe
begin atomic
  delete from market_structure_demands as demand
  where (demand.character_id, demand.subject_lifecycle_id,
    demand.authorization_generation, demand.organization_version, demand.structure_id) in (
    select expired.character_id, expired.subject_lifecycle_id,
      expired.authorization_generation, expired.organization_version, expired.structure_id
    from market_structure_demands as expired
    where expired.requested_at < (input ->> 'now'::text)::timestamptz - interval '24:00:00'
    order by expired.requested_at, expired.character_id, expired.structure_id
    limit 1000
  );
  select jsonb_build_object('outcome'::text, 'checked'::text);
end;

create function eve_module_market.persist_read_market_quote_rows(input jsonb)
returns jsonb
language sql
stable
parallel unsafe
return (
  with eligible as (
    select
      market_order.observation_id,
      market_order.order_id,
      market_order.type_id,
      market_order.location_id,
      market_order.system_id,
      market_order.side,
      market_order.price,
      market_order.volume_remain,
      market_order.issued_at,
      market_order.duration_days,
      market_order.minimum_volume,
      market_order.order_range
    from market_observation_orders as market_order
    join market_observations as observation
      on observation.observation_id = market_order.observation_id
    join market_profiles as profile
      on profile.profile_id = observation.profile_id
      and profile.revision = observation.profile_revision
    where observation.observation_id = (input ->> 'observationId'::text)::uuid
      and observation.status = 'complete'::text
      and profile.enabled
      and market_order.type_id = (input ->> 'typeId'::text)::bigint
      and market_order.side = input ->> 'side'::text
      and (jsonb_array_length(input -> 'locationIds'::text) = 0
        or market_order.location_id in (
          select selected.value::bigint
          from jsonb_array_elements_text(input -> 'locationIds'::text) as selected(value)
        ))
      and (
        (input ->> 'cursorPrice'::text) is null
        or (market_order.side = 'sell'::text and (
          market_order.price > (input ->> 'cursorPrice'::text)::numeric
          or (market_order.price = (input ->> 'cursorPrice'::text)::numeric
            and row(market_order.issued_at, market_order.order_id) > row(
              (input ->> 'cursorIssuedAt'::text)::timestamptz,
              (input ->> 'cursorOrderId'::text)::bigint))
        ))
        or (market_order.side = 'buy'::text and (
          market_order.price < (input ->> 'cursorPrice'::text)::numeric
          or (market_order.price = (input ->> 'cursorPrice'::text)::numeric
            and row(market_order.issued_at, market_order.order_id) > row(
              (input ->> 'cursorIssuedAt'::text)::timestamptz,
              (input ->> 'cursorOrderId'::text)::bigint))
        ))
      )
    order by
      case when market_order.side = 'sell'::text then market_order.price else null::numeric end,
      case when market_order.side = 'buy'::text then market_order.price else null::numeric end desc,
      market_order.issued_at,
      market_order.order_id
    limit (input ->> 'limit'::text)::integer + 1
  ), visible as (
    select
      eligible.observation_id,
      eligible.order_id,
      eligible.type_id,
      eligible.location_id,
      eligible.system_id,
      eligible.side,
      eligible.price,
      eligible.volume_remain,
      eligible.issued_at,
      eligible.duration_days,
      eligible.minimum_volume,
      eligible.order_range
    from eligible
    order by
      case when eligible.side = 'sell'::text then eligible.price else null::numeric end,
      case when eligible.side = 'buy'::text then eligible.price else null::numeric end desc,
      eligible.issued_at,
      eligible.order_id
    limit (input ->> 'limit'::text)::integer
  )
  select jsonb_build_object(
    'rows'::text,
    coalesce(jsonb_agg(jsonb_build_object(
      'orderId'::text, visible.order_id,
      'typeId'::text, visible.type_id,
      'side'::text, visible.side,
      'price'::text, visible.price::text,
      'volumeRemain'::text, visible.volume_remain,
      'locationId'::text, visible.location_id,
      'solarSystemId'::text, visible.system_id,
      'issuedAt'::text, visible.issued_at,
      'durationDays'::text, visible.duration_days,
      'minimumVolume'::text, visible.minimum_volume,
      'range'::text, visible.order_range
    ) order by
      case when visible.side = 'sell'::text then visible.price else null::numeric end,
      case when visible.side = 'buy'::text then visible.price else null::numeric end desc,
      visible.issued_at,
      visible.order_id
    ), '[]'::jsonb),
    'hasMore'::text,
    (select count(*) > (input ->> 'limit'::text)::integer from eligible)
  ) from visible
);

create function eve_module_market.persist_cleanup_market_observation_backlog(input jsonb)
returns jsonb
language sql
volatile
parallel unsafe
begin atomic
  delete from market_observations as observation
  where observation.observation_id in (
    select candidate.observation_id
    from market_observations as candidate
    left join market_current_observations as pointer
      on pointer.observation_id = candidate.observation_id
    where pointer.observation_id is null
      and candidate.started_at < (input ->> 'now'::text)::timestamptz - interval '00:15:00'
    order by candidate.started_at, candidate.observation_id
    limit 64
  );

  select jsonb_build_object('outcome'::text, 'checked'::text);
end;

create function eve_module_market.persist_record_market_type_failure(input jsonb)
returns jsonb
language sql
volatile
parallel unsafe
begin atomic
  insert into market_type_failures (profile_id, type_id, profile_revision, attempt_id, attempted_at)
  select profile.profile_id,
    coalesce((input ->> 'typeId'::text)::bigint, 0::bigint),
    profile.revision,
    (input ->> 'attemptId'::text)::uuid,
    (input ->> 'attemptedAt'::text)::timestamptz
  from market_profiles as profile
  where profile.profile_id = (input ->> 'profileId'::text)::uuid
    and profile.revision = (input ->> 'expectedRevision'::text)::bigint
    and profile.enabled
    and ((profile.mode = 'region'::text and (input ->> 'typeId'::text) is null)
      or (profile.mode = 'watched-types'::text
        and profile.watched_type_ids @> jsonb_build_array((input ->> 'typeId'::text)::bigint)))
  on conflict (profile_id, type_id) do update
    set profile_revision = excluded.profile_revision,
        attempt_id = excluded.attempt_id,
        attempted_at = excluded.attempted_at
    where market_type_failures.profile_revision < excluded.profile_revision
      or (market_type_failures.profile_revision = excluded.profile_revision
        and market_type_failures.attempted_at <= excluded.attempted_at);

  select case when exists (
    select 1 from market_type_failures as failure
    where failure.profile_id = (input ->> 'profileId'::text)::uuid
      and failure.type_id = coalesce((input ->> 'typeId'::text)::bigint, 0::bigint)
      and failure.profile_revision = (input ->> 'expectedRevision'::text)::bigint
      and failure.attempt_id = (input ->> 'attemptId'::text)::uuid
  ) then jsonb_build_object('outcome'::text, 'recorded'::text)
    else jsonb_build_object('outcome'::text, 'obsolete'::text) end as outcome;
end;

create function eve_module_market.persist_read_market_replacement_status(input jsonb)
returns jsonb
language sql
stable
parallel unsafe
return (
  select jsonb_build_object('attemptedAt'::text, failure.attempted_at)
  from market_profiles as profile
  join market_type_failures as failure
    on failure.profile_id = profile.profile_id
    and failure.profile_revision = profile.revision
    and failure.type_id = case when profile.mode = 'region'::text then 0::bigint
      else (input ->> 'typeId'::text)::bigint end
  where profile.profile_id = (input ->> 'profileId'::text)::uuid
    and profile.enabled
    and failure.attempted_at > coalesce((
      select observation.published_at
      from market_current_observations as pointer
      join market_observations as observation
        on observation.observation_id = pointer.observation_id
      where pointer.market_key = profile.profile_id::text || ':'::text ||
        case when profile.mode = 'region'::text then 'all'::text
          else (input ->> 'typeId'::text) end
        and observation.profile_revision = profile.revision
        and observation.status = 'complete'::text
    ), '-infinity'::timestamptz)
  limit 1
);

create function eve_module_market.persist_request_market_history_demand(input jsonb)
returns jsonb
language sql
volatile
parallel unsafe
begin atomic
  insert into market_history_demands (
    profile_id, type_id, profile_revision, requested_at, last_request_id
  )
  select
    profile.profile_id,
    (input ->> 'typeId'::text)::bigint,
    profile.revision,
    now(),
    (input ->> 'requestId'::text)::uuid
  from market_profiles as profile
  cross join (select capacity_lock.singleton from market_profile_capacity as capacity_lock
    for update of capacity_lock) as capacity
  where profile.profile_id = (input ->> 'profileId'::text)::uuid
    and profile.revision = (input ->> 'expectedRevision'::text)::bigint
    and profile.enabled
    and profile.mode = 'region'::text
    and (
      (select count(*) from market_history_demands as demands
       where demands.profile_id = profile.profile_id
         and demands.profile_revision = profile.revision) < 256
      or exists (select 1 from market_history_demands as existing
        where existing.profile_id = profile.profile_id
          and existing.type_id = (input ->> 'typeId'::text)::bigint)
    )
  on conflict (profile_id, type_id) do update
  set profile_revision = excluded.profile_revision,
      requested_at = excluded.requested_at,
      last_request_id = excluded.last_request_id
  where market_history_demands.profile_revision <> excluded.profile_revision
    or market_history_demands.requested_at < now() - interval '00:01:00';

  select coalesce(
    (select jsonb_build_object('outcome'::text, case
        when demand.last_request_id = (input ->> 'requestId'::text)::uuid then 'accepted'::text
        else 'duplicate'::text
      end)
    from market_history_demands as demand
    join market_profiles as profile on profile.profile_id = demand.profile_id
    where demand.profile_id = (input ->> 'profileId'::text)::uuid
      and demand.type_id = (input ->> 'typeId'::text)::bigint
      and demand.profile_revision = profile.revision
      and profile.enabled),
    jsonb_build_object('outcome'::text, 'unavailable'::text)
  ) as outcome;
end;

create function eve_module_market.persist_publish_current_market_observation(input jsonb)
returns jsonb
language sql
volatile
parallel unsafe
begin atomic
  update market_observations as observation
  set status = 'complete'::text,
      observed_at = (select min(page.validated_at) from market_observation_pages as page
        where page.observation_id = observation.observation_id),
      earliest_validated_at = (select min(page.validated_at) from market_observation_pages as page
        where page.observation_id = observation.observation_id),
      latest_validated_at = (select max(page.validated_at) from market_observation_pages as page
        where page.observation_id = observation.observation_id),
      fresh_until = (select min(page.fresh_until) from market_observation_pages as page
        where page.observation_id = observation.observation_id),
      published_at = now(),
      order_count = (select count(*)::integer from market_observation_orders as market_order
        where market_order.observation_id = observation.observation_id)
  where observation.observation_id = (input ->> 'observationId'::text)::uuid
    and observation.status = 'staging'::text
    and exists (
      select 1 from market_profiles as profile
      where profile.profile_id = observation.profile_id
        and profile.revision = observation.profile_revision
        and profile.enabled
      for share of profile
    )
    and (select count(*) from market_observation_pages as page
      where page.observation_id = observation.observation_id) = observation.expected_pages
    and (select count(*) from market_observation_orders as market_order
      where market_order.observation_id = observation.observation_id) <= 512000
    and (select count(*) from market_observation_orders as market_order
      where market_order.observation_id = observation.observation_id) =
        (select sum(page.row_count) from market_observation_pages as page
          where page.observation_id = observation.observation_id)
    and (select max(page.validated_at) - min(page.validated_at)
      from market_observation_pages as page
      where page.observation_id = observation.observation_id) <= interval '00:01:00'
    and (select min(page.fresh_until) from market_observation_pages as page
      where page.observation_id = observation.observation_id) > now()
    and not exists (
      select 1 from market_observation_pages as page
      where page.observation_id = observation.observation_id
        and (page.expected_pages <> observation.expected_pages
          or page.page > observation.expected_pages
          or page.fresh_until <= page.validated_at)
    )
    and (observation.type_id is null or not exists (
      select 1 from market_observation_orders as market_order
      where market_order.observation_id = observation.observation_id
        and market_order.type_id <> observation.type_id
    ));

  insert into market_current_observations (market_key, observation_id, observed_at)
  select observation.market_key, observation.observation_id, observation.observed_at
  from market_observations as observation
  join market_profiles as profile on profile.profile_id = observation.profile_id
  where observation.observation_id = (input ->> 'observationId'::text)::uuid
    and observation.status = 'complete'::text
    and profile.enabled
    and profile.revision = observation.profile_revision
  on conflict (market_key) do update
    set observation_id = excluded.observation_id,
        observed_at = excluded.observed_at
    where market_current_observations.observed_at < excluded.observed_at;

  update market_profiles as profile
  set next_due_at = (
        select min(coalesce(deadline_book.fresh_until, now()))
        from (
          select null::bigint as type_id where profile.mode = 'region'::text
          union all
          select watched_type.value::bigint
          from jsonb_array_elements_text(profile.watched_type_ids) as watched_type(value)
        ) as required_book
        left join market_current_observations as deadline_pointer
          on deadline_pointer.market_key = profile.profile_id::text || ':'::text ||
            coalesce(required_book.type_id::text, 'all'::text)
        left join market_observations as deadline_book
          on deadline_book.observation_id = deadline_pointer.observation_id
          and deadline_book.profile_id = profile.profile_id
          and deadline_book.profile_revision = profile.revision
          and deadline_book.status = 'complete'::text
      ),
      last_failure_class = null::text,
      updated_at = now()
  from market_observations as observation
  join market_current_observations as pointer on pointer.market_key = observation.market_key
  join market_observations as current_book on current_book.observation_id = pointer.observation_id
  where observation.observation_id = (input ->> 'observationId'::text)::uuid
    and observation.status = 'complete'::text
    and profile.profile_id = observation.profile_id
    and profile.revision = observation.profile_revision
    and profile.enabled
    and current_book.profile_revision = observation.profile_revision
    and current_book.observed_at = observation.observed_at
    and current_book.fresh_until > now();

  select coalesce((
    select jsonb_build_object('outcome'::text,
      case when pointer.observation_id = observation.observation_id then 'published'::text
        else 'unchanged'::text end)
    from market_observations as observation
    join market_profiles as profile on profile.profile_id = observation.profile_id
    join market_current_observations as pointer on pointer.market_key = observation.market_key
    join market_observations as current_book on current_book.observation_id = pointer.observation_id
    where observation.observation_id = (input ->> 'observationId'::text)::uuid
      and observation.status = 'complete'::text
      and profile.enabled
      and profile.revision = observation.profile_revision
      and current_book.profile_revision = observation.profile_revision
      and current_book.observed_at = observation.observed_at
      and current_book.fresh_until > now()
  ), jsonb_build_object('outcome'::text, 'incomplete'::text));
end;
