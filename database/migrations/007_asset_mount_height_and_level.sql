-- Height of an asset's mounting point above the ground (a gateway on a roof, a tank on top of a
-- tower), so the viewer can draw it where it is. 0: at ground level.
ALTER TABLE assets
  ADD COLUMN mount_height_m double precision NOT NULL DEFAULT 0
  CHECK(mount_height_m BETWEEN 0 AND 500);
-- Water level (metres above the probe's reference) for level probes in ponds and tanks.
ALTER TABLE sensors DROP CONSTRAINT sensors_metric_type_check;
ALTER TABLE sensors ADD CONSTRAINT sensors_metric_type_check
  CHECK(metric_type IN ('temperature','vibration','pressure','level'));
