CREATE EXTENSION IF NOT EXISTS postgis;
CREATE TABLE organizations (
  id uuid PRIMARY KEY, name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE installations (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL, description text NOT NULL,
  location geometry(Point,4326) NOT NULL,
  UNIQUE(id,organization_id),
  CHECK(ST_Y(location) BETWEEN -90 AND 90 AND ST_X(location) BETWEEN -180 AND 180)
);
CREATE TABLE assets (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id),
  installation_id uuid NOT NULL, name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
  type text NOT NULL CHECK(type IN ('pump','transformer','reservoir','gateway','valve','turbine')),
  status text NOT NULL DEFAULT 'healthy' CHECK(status IN ('healthy','warning','critical')),
  location geometry(Point,4326) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(installation_id,organization_id) REFERENCES installations(id,organization_id),
  CHECK(ST_Y(location) BETWEEN -90 AND 90 AND ST_X(location) BETWEEN -180 AND 180)
);
CREATE INDEX assets_location_gist ON assets USING gist(location);
CREATE INDEX assets_geography_gist ON assets USING gist((location::geography));
CREATE INDEX installations_location_gist ON installations USING gist(location);
CREATE INDEX assets_installation_idx ON assets(installation_id);
CREATE INDEX assets_organization_idx ON assets(organization_id);
CREATE TABLE sensors (
  id uuid PRIMARY KEY, asset_id uuid NOT NULL REFERENCES assets(id),
  metric_type text NOT NULL CHECK(metric_type IN ('temperature','vibration','pressure')),
  unit text NOT NULL, warning_threshold double precision NOT NULL,
  critical_threshold double precision NOT NULL,
  baseline double precision NOT NULL,
  UNIQUE(id,asset_id), UNIQUE(asset_id,metric_type),
  CHECK(baseline >= 0 AND baseline < warning_threshold AND warning_threshold < critical_threshold)
);
CREATE TABLE sensor_readings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sensor_id uuid NOT NULL REFERENCES sensors(id), value double precision NOT NULL CHECK(value >= 0 AND value < 'Infinity'::float8),
  recorded_at timestamptz NOT NULL DEFAULT now(), simulated boolean NOT NULL DEFAULT true,
  UNIQUE(sensor_id,recorded_at)
);
CREATE INDEX readings_sensor_time_idx ON sensor_readings(sensor_id,recorded_at DESC);
CREATE TABLE alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), asset_id uuid NOT NULL REFERENCES assets(id),
  sensor_id uuid, severity text NOT NULL CHECK(severity IN ('warning','critical')),
  message text NOT NULL CHECK(length(message) BETWEEN 1 AND 500),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','resolved')),
  source text NOT NULL CHECK(source IN ('telemetry','manual')),
  triggered_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz,
  FOREIGN KEY(sensor_id,asset_id) REFERENCES sensors(id,asset_id),
  CHECK((status='active' AND resolved_at IS NULL) OR (status='resolved' AND resolved_at IS NOT NULL))
);
CREATE UNIQUE INDEX alerts_active_sensor_unique ON alerts(sensor_id) WHERE status='active' AND sensor_id IS NOT NULL;
CREATE INDEX alerts_asset_status_idx ON alerts(asset_id,status);
CREATE INDEX alerts_status_time_idx ON alerts(status,triggered_at DESC);
CREATE TABLE simulation_overrides (
  sensor_id uuid PRIMARY KEY REFERENCES sensors(id),
  mode text NOT NULL CHECK(mode IN ('warning','critical')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE telemetry_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), sequence bigint NOT NULL DEFAULT 0
);
INSERT INTO telemetry_state(singleton) VALUES(true);
