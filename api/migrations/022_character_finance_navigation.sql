delete from deployment_shell_navigation_order
where owner_id = 'core' and navigation_id = 'core-character-finance';

update deployment_shell_navigation_order
set navigation_id = 'core-character-finance'
where owner_id = 'core' and navigation_id = 'core-character-wallet';
