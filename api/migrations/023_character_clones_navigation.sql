with eligible_skills as (
  select position
  from deployment_shell_navigation_order
  where owner_id = 'core'
    and navigation_id = 'core-character-skills'
    and not exists (
      select 1
      from deployment_shell_navigation_order
      where owner_id = 'core' and navigation_id = 'core-character-clones'
    )
), shifted as (
  update deployment_shell_navigation_order
  set position = position + 1
  where exists (select 1 from eligible_skills)
    and position > (select position from eligible_skills)
)
insert into deployment_shell_navigation_order (owner_id, navigation_id, position)
select 'core', 'core-character-clones', position + 1
from eligible_skills;
