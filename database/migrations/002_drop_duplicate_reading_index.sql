-- UNIQUE(sensor_id, recorded_at) already provides this btree; PostgreSQL scans it backwards for DESC.
DROP INDEX IF EXISTS readings_sensor_time_idx;
