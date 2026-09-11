alter table deployment_installation_settings
  add column owner_admin_id uuid;

update deployment_installation_settings as installation
set owner_admin_id = settings.owner_admin_id,
    updated_at = clock_timestamp()
from deployment_settings as settings
where installation.id = settings.id;

alter table deployment_installation_settings
  add constraint deployment_installation_settings_owner_admin_id_key unique (owner_admin_id),
  add constraint deployment_installation_settings_owner_admin_id_fkey
    foreign key (owner_admin_id) references deployment_admins(id) on delete restrict;

alter table deployment_settings
  drop constraint deployment_settings_owner_admin_id_fkey,
  drop constraint deployment_settings_owner_admin_id_key,
  drop column owner_admin_id;
