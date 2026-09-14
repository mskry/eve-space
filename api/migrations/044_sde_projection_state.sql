create table sde_projection_state (
  singleton boolean primary key default true,
  active_build_number bigint references sde_builds (build_number),
  constraint sde_projection_state_singleton_check check (singleton)
);

insert into sde_projection_state (active_build_number)
select max(build_number) from sde_builds;
