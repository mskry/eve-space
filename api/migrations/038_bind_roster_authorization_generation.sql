delete from organization_corporation_roster_observations;

alter table organization_corporation_roster_observations
  add column authorization_generation integer not null;

alter table organization_corporation_roster_observations
  add constraint organization_corporation_roster_authorization_generation_check
  check (authorization_generation >= 0);
