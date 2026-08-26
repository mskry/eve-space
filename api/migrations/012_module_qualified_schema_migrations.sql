alter table schema_migrations
  add column module text default 'core';

update schema_migrations
set module = 'core'
where module is null;

alter table schema_migrations
  alter column module set not null,
  drop constraint schema_migrations_pkey,
  add constraint schema_migrations_pkey primary key (module, name);
