create function eve_module_market.persist_publish_collected_market_observation(input jsonb)
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
    and current_book.observed_at = observation.observed_at;

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
  ), jsonb_build_object('outcome'::text, 'incomplete'::text));
end;
