with eligible_finance as (
  select position
  from deployment_shell_navigation_order
  where owner_id = 'core'
    and navigation_id = 'core-character-finance'
    and not exists (
      select 1
      from deployment_shell_navigation_order
      where owner_id = 'core' and navigation_id = 'core-character-assets'
    )
), shifted as (
  update deployment_shell_navigation_order
  set position = position + 1
  where exists (select 1 from eligible_finance)
    and position > (select position from eligible_finance)
)
insert into deployment_shell_navigation_order (owner_id, navigation_id, position)
select 'core', 'core-character-assets', position + 1
from eligible_finance;
