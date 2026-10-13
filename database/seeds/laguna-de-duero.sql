-- Default demo scenario: Laguna de Duero (Valladolid). FICTIONAL facilities and assets placed on
-- real places that can be checked in the PNOA-LiDAR point cloud (tower roofs in Torrelago, the
-- shore of the laguna, the sports hall roof, a ~33 m cylindrical structure on the north-east
-- hill). They are not the town's real systems, and all telemetry is simulated.
-- Same ids as the Valladolid scenario (database/seeds/valladolid.sql): a database holds one
-- scenario, whichever was seeded first; seeding again never overwrites data.
INSERT INTO organizations(id,name,region) VALUES('00000000-0000-4000-8000-000000000001','GeoTwin Lab (demo)','Laguna de Duero (Valladolid)')
ON CONFLICT(id) DO UPDATE SET region=coalesce(organizations.region,excluded.region);
INSERT INTO installations(id,organization_id,name,description,location) VALUES
('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','Torrelago · torres residenciales','Instalación ficticia: pasarelas y equipos sobre cubiertas y junto a las torres de Torrelago, situados con la nube LiDAR PNOA. Telemetría simulada.',ST_SetSRID(ST_MakePoint(-4.725258,41.589069),4326)),
('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','Laguna y zona deportiva','Instalación ficticia: sonda de nivel en la orilla de la laguna y equipos en el polideportivo. No son los sistemas reales del municipio.',ST_SetSRID(ST_MakePoint(-4.722179,41.586053),4326)),
('10000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','Depósito elevado del cerro','Instalación ficticia sobre una estructura cilíndrica de unos 33 m visible en la nube LiDAR, en el cerro del noreste. Telemetría simulada.',ST_SetSRID(ST_MakePoint(-4.710608,41.584019),4326))
ON CONFLICT DO NOTHING;
-- Positions and mounting heights (m above the ground) measured on the LiDAR: roofs from the
-- class 6 points, ground from class 2 (see docs/laguna-de-duero.md).
INSERT INTO assets(id,organization_id,installation_id,name,type,location,mount_height_m)
SELECT ('20000000-0000-4000-8000-'||lpad(a.n::text,12,'0'))::uuid,
 '00000000-0000-4000-8000-000000000001'::uuid,
 ('10000000-0000-4000-8000-'||lpad(a.i::text,12,'0'))::uuid,
 a.name,a.type,ST_SetSRID(ST_MakePoint(a.lng,a.lat),4326),a.h
FROM (VALUES
 (1,1,'Pasarela LoRa · torre sur','gateway',-4.725652,41.587860,41.9),
 (2,1,'Grupo de presión · Torrelago','pump',-4.725251,41.588560,0),
 (3,1,'Centro de transformación · Torrelago','transformer',-4.725384,41.589072,0),
 (4,1,'Pasarela LoRa · torre norte','gateway',-4.724305,41.590574,41.7),
 (5,1,'Válvula de sector · Torrelago','valve',-4.724757,41.588469,0),
 (6,1,'Depósito de cubierta · torre oeste','reservoir',-4.726391,41.587724,41.5),
 (7,2,'Sonda de nivel · laguna','reservoir',-4.721907,41.586422,0),
 (8,2,'Bombeo de recirculación · laguna','pump',-4.721184,41.584717,0),
 (9,2,'Bomba de las piscinas','pump',-4.721603,41.586962,0),
 (10,2,'Pasarela · cubierta del pabellón','gateway',-4.723770,41.587245,12.3),
 (11,2,'Cuadro eléctrico · polideportivo','transformer',-4.724118,41.587028,0),
 (12,2,'Válvula de riego · campo de fútbol','valve',-4.725184,41.586278,0),
 (13,3,'Depósito elevado','reservoir',-4.710704,41.584018,33.1),
 (14,3,'Bombeo de impulsión','pump',-4.710489,41.583827,0),
 (15,3,'Válvula de salida','valve',-4.710265,41.583957,0),
 (16,3,'Transformador del bombeo','transformer',-4.710192,41.584160,0),
 (17,3,'Pasarela de telemetría · depósito','gateway',-4.710778,41.584080,32.3),
 (18,3,'Bomba de reserva','pump',-4.710441,41.584269,0)
) a(n,i,name,type,lng,lat,h)
ON CONFLICT DO NOTHING;
-- Two sensors per asset (2n-1 and 2n), chosen by type. Thresholds: warning and critical when the
-- value goes above them (for levels: water too high).
INSERT INTO sensors(id,asset_id,metric_type,unit,warning_threshold,critical_threshold,baseline)
SELECT ('30000000-0000-4000-8000-'||lpad((2*a.n-2+m.k)::text,12,'0'))::uuid,
 ('20000000-0000-4000-8000-'||lpad(a.n::text,12,'0'))::uuid,
 m.metric,m.unit,m.warning,m.critical,m.baseline
FROM (VALUES (1,'gateway'),(2,'pump'),(3,'transformer'),(4,'gateway'),(5,'valve'),(6,'rooftank'),
 (7,'pond'),(8,'pump'),(9,'pump'),(10,'gateway'),(11,'transformer'),(12,'valve'),
 (13,'tower'),(14,'pump'),(15,'valve'),(16,'transformer'),(17,'gateway'),(18,'pump')) a(n,kind)
JOIN (VALUES
 ('gateway',1,'temperature','°C',70,85,42),('gateway',2,'vibration','mm/s',6,9,2.4),
 ('transformer',1,'temperature','°C',70,85,42),('transformer',2,'vibration','mm/s',6,9,2.4),
 ('pump',1,'vibration','mm/s',6,9,2.4),('pump',2,'pressure','bar',6,7,4.2),
 ('valve',1,'pressure','bar',6,7,4.2),('valve',2,'vibration','mm/s',6,9,2.4),
 ('rooftank',1,'level','m',1.7,1.9,1.1),('rooftank',2,'temperature','°C',26,30,16),
 ('pond',1,'level','m',1.8,2.1,1.2),('pond',2,'temperature','°C',26,30,16),
 ('tower',1,'level','m',8.5,9.2,5.5),('tower',2,'temperature','°C',24,28,14)
) m(kind,k,metric,unit,warning,critical,baseline) ON m.kind=a.kind
ON CONFLICT DO NOTHING;
-- Add a deterministic 30-minute history only to sensors without readings. Never overwrite operational data.
-- The phase is the last four hex digits of the sensor UUID, as in apps/api/src/simulator/domain.ts.
INSERT INTO sensor_readings(sensor_id,value,recorded_at)
SELECT s.id,round((s.baseline*(1+0.12*sin(t.n*0.37+('x'||right(s.id::text,4))::bit(16)::int)))::numeric,2),
 date_trunc('minute',now()) - (60-t.n)*interval '30 seconds'
FROM sensors s CROSS JOIN generate_series(0,59) t(n)
WHERE NOT EXISTS(SELECT 1 FROM sensor_readings r WHERE r.sensor_id=s.id)
ON CONFLICT DO NOTHING;
