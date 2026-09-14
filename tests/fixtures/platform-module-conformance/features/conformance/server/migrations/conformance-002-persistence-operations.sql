create function eve_module_conformance.persist_read_conformance_snapshot(input jsonb)
returns jsonb
language sql
stable
parallel unsafe
return (
  select jsonb_build_object(
    'characterId'::text,
    conformance_snapshots.character_id,
    'pilotsOnline'::text,
    conformance_snapshots.pilots_online,
    'validatedAt'::text,
    conformance_snapshots.validated_at
  )
  from conformance_snapshots
  where conformance_snapshots.character_id = (input ->> 'characterId'::text)::bigint
);

create function eve_module_conformance.persist_upsert_conformance_snapshot(input jsonb)
returns jsonb
language sql
volatile
parallel unsafe
begin atomic
  insert into conformance_snapshots (character_id, pilots_online, validated_at)
  values (
    (input ->> 'characterId'::text)::bigint,
    (input ->> 'pilotsOnline'::text)::integer,
    (input ->> 'validatedAt'::text)::timestamptz
  )
  on conflict (character_id) do update
  set pilots_online = excluded.pilots_online,
      validated_at = excluded.validated_at;

  select jsonb_build_object('applied'::text, true) as result;
end;
