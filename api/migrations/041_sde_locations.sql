create table sde_solar_systems (
  solar_system_id bigint primary key,
  name text not null,
  security_status double precision not null check (security_status between -1 and 1)
);

create table sde_npc_stations (
  station_id bigint primary key,
  solar_system_id bigint not null references sde_solar_systems (solar_system_id)
);

create index sde_npc_stations_solar_system_id_idx on sde_npc_stations (solar_system_id);
