alter table sde_solar_systems
  add column region_id bigint;

alter table sde_solar_systems
  add constraint sde_solar_systems_region_id_check
  check (region_id is null or region_id > 0);
