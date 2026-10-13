-- Level probes (a water-level sensor on a shore or in a tank) get their own asset type instead of
-- passing for a reservoir.
ALTER TABLE assets DROP CONSTRAINT assets_type_check;
ALTER TABLE assets ADD CONSTRAINT assets_type_check
  CHECK(type IN ('pump','transformer','reservoir','gateway','valve','turbine','level_probe'));
-- The Laguna de Duero demo seeded its lake probe as a reservoir before this type existed.
UPDATE assets SET type='level_probe'
WHERE id='20000000-0000-4000-8000-000000000007' AND name='Sonda de nivel · laguna' AND type='reservoir';
