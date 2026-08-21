-- Most SDE datasets key rows by integer id, but a few (militaryCampaigns,
-- characterTitles, translationLanguages, ...) key by UUID or language-code
-- strings. Widen the catch-all key column to fit both.
alter table sde_dataset_rows
  alter column key type text using key::text;
