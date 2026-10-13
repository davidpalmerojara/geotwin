-- Alternative demo scenario: Valladolid city (npm run db:seed -- valladolid, or DEMO_SEED=valladolid).
-- Fictional facilities / assets at real geographic coordinates. All telemetry is simulated.
INSERT INTO organizations(id,name,region) VALUES('00000000-0000-4000-8000-000000000001','Valladolid Infrastructure Lab','Valladolid, España')
ON CONFLICT(id) DO UPDATE SET region=coalesce(organizations.region,excluded.region);
INSERT INTO installations(id,organization_id,name,description,location) VALUES
('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','Pisuerga · Water Hub','Instalación ficticia de distribución de agua, entorno del Pisuerga.',ST_SetSRID(ST_MakePoint(-4.7370,41.6550),4326)),
('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','San Cristóbal · Energy Hub','Subestación ficticia en el entorno industrial de San Cristóbal.',ST_SetSRID(ST_MakePoint(-4.7060,41.6200),4326)),
('10000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','Campus · Research Hub','Centro ficticio de monitorización cerca del campus universitario.',ST_SetSRID(ST_MakePoint(-4.7130,41.6630),4326))
ON CONFLICT DO NOTHING;
INSERT INTO assets(id,organization_id,installation_id,name,type,location)
SELECT ('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 '00000000-0000-4000-8000-000000000001'::uuid,
 ('10000000-0000-4000-8000-'||lpad(((n-1)/6+1)::text,12,'0'))::uuid,
 (ARRAY['Pump','Transformer','Reservoir','Gateway','Valve','Turbine'])[(n-1)%6+1] || ' ' || lpad(n::text,2,'0'),
 (ARRAY['pump','transformer','reservoir','gateway','valve','turbine'])[(n-1)%6+1],
 ST_SetSRID(ST_MakePoint(
  (ARRAY[-4.7370,-4.7060,-4.7130])[(n-1)/6+1] + ((n-1)%3-1)*0.0008,
  (ARRAY[41.6550,41.6200,41.6630])[(n-1)/6+1] + ((n-1)%6/3-0.5)*0.0012
 ),4326)
FROM generate_series(1,18) n ON CONFLICT DO NOTHING;
INSERT INTO sensors(id,asset_id,metric_type,unit,warning_threshold,critical_threshold,baseline)
SELECT ('30000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 ('20000000-0000-4000-8000-'||lpad(((n-1)/2+1)::text,12,'0'))::uuid,
 CASE WHEN n%2=1 THEN 'temperature' ELSE 'vibration' END,
 CASE WHEN n%2=1 THEN '°C' ELSE 'mm/s' END,
 CASE WHEN n%2=1 THEN 70 ELSE 6 END,
 CASE WHEN n%2=1 THEN 85 ELSE 9 END,
 CASE WHEN n%2=1 THEN 42 ELSE 2.4 END
FROM generate_series(1,36) n ON CONFLICT DO NOTHING;
-- Add a deterministic 30-minute history only to sensors without readings. Never overwrite operational data.
-- The phase is the last four hex digits of the sensor UUID, as in apps/api/src/simulator/domain.ts.
INSERT INTO sensor_readings(sensor_id,value,recorded_at)
SELECT s.id,round((s.baseline*(1+0.12*sin(t.n*0.37+('x'||right(s.id::text,4))::bit(16)::int)))::numeric,2),
 date_trunc('minute',now()) - (60-t.n)*interval '30 seconds'
FROM sensors s CROSS JOIN generate_series(0,59) t(n)
WHERE NOT EXISTS(SELECT 1 FROM sensor_readings r WHERE r.sensor_id=s.id)
ON CONFLICT DO NOTHING;
