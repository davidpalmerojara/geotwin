-- LiDAR point-cloud layers. The API stores the uploaded LAS/LAZ in object storage and queues a
-- job; the worker converts it to 3D Tiles and fills in the metadata below.
CREATE TABLE layers (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
  kind text NOT NULL DEFAULT 'pointcloud' CHECK(kind IN ('pointcloud')),
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','ready','failed')),
  stage text NOT NULL DEFAULT 'queued'
    CHECK(stage IN ('queued','downloading','inspecting','tiling','uploading','done')),
  progress smallint NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
  error text CHECK(length(error) BETWEEN 1 AND 1000),
  -- Source file as uploaded (kept so a job can be re-run).
  source_key text NOT NULL CHECK(length(source_key) BETWEEN 1 AND 512),
  source_size bigint NOT NULL CHECK(source_size > 0),
  source_format text NOT NULL CHECK(source_format IN ('las','laz')),
  original_filename text NOT NULL CHECK(length(original_filename) BETWEEN 1 AND 255),
  source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[0-9a-f]{64}$'),
  -- Horizontal CRS of the source. PNOA-LiDAR uses ETRS89 / UTM 30N.
  crs_in text NOT NULL DEFAULT 'EPSG:25830' CHECK(crs_in ~ '^EPSG:[0-9]{4,6}$'),
  -- Heights in the source: orthometric (PNOA, REDNAP) or already ellipsoidal.
  vertical_datum text NOT NULL DEFAULT 'orthometric'
    CHECK(vertical_datum IN ('orthometric','ellipsoidal')),
  -- Optional per-layer geoid undulation (m) chosen by the user; wins over the computed one.
  geoid_override_m double precision CHECK(geoid_override_m BETWEEN -150 AND 150),
  -- Undulation N actually applied (h = H + N) and how it was obtained.
  geoid_offset_m double precision CHECK(geoid_offset_m BETWEEN -150 AND 150),
  geoid_method text CHECK(geoid_method IN ('egm08_rednap_grid','egm96_centre','override','none')),
  point_count bigint CHECK(point_count >= 0),
  point_format smallint CHECK(point_format BETWEEN 0 AND 10),
  bbox geometry(Polygon,4326),
  center geometry(Point,4326),
  -- Heights as stored in the source file (orthometric for PNOA).
  min_height_m double precision,
  max_height_m double precision,
  tileset_root_key text CHECK(length(tileset_root_key) BETWEEN 1 AND 512),
  attribution text CHECK(length(attribution) BETWEEN 1 AND 500),
  job_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- One copy of each file per organization; the API answers 409 for a second upload.
  UNIQUE(organization_id, source_sha256),
  CHECK((status = 'failed') = (error IS NOT NULL)),
  CHECK(status <> 'ready' OR (progress = 100 AND stage = 'done' AND tileset_root_key IS NOT NULL
    AND point_count IS NOT NULL AND bbox IS NOT NULL AND center IS NOT NULL
    AND geoid_method IS NOT NULL AND geoid_offset_m IS NOT NULL)),
  CHECK(min_height_m IS NULL OR max_height_m IS NULL OR min_height_m <= max_height_m),
  CHECK(vertical_datum = 'orthometric' OR geoid_method IS NULL OR geoid_method = 'none'),
  CHECK(center IS NULL OR (ST_Y(center) BETWEEN -90 AND 90 AND ST_X(center) BETWEEN -180 AND 180))
);
CREATE INDEX layers_organization_created_idx ON layers(organization_id, created_at DESC);
CREATE INDEX layers_bbox_gist ON layers USING gist(bbox);
-- Small partial index for "what is still running" (status pages, stuck-job checks).
CREATE INDEX layers_pending_idx ON layers(updated_at) WHERE status IN ('queued','processing');
