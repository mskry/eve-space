create table deployment_installation_settings (
  id smallint primary key default 1,
  planner_schedule_offset_ms integer not null default (floor(random() * 60000)::integer),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deployment_installation_settings_singleton_check check (id = 1),
  constraint deployment_installation_settings_planner_offset_check
    check (planner_schedule_offset_ms >= 0)
);

insert into deployment_installation_settings (id) values (1);
