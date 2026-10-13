-- What the worker leaves out of a layer's tiles (PNOA-LiDAR overlap points, class 12, and noise,
-- classes 7 and 18) and the ground model (DTM, from class 2) it stores next to the tiles so the
-- viewer can use it as terrain. point_count is the number of points drawn.
ALTER TABLE layers
  ADD COLUMN excluded_points bigint CHECK(excluded_points >= 0),
  ADD COLUMN excluded_classes smallint[] CHECK(cardinality(excluded_classes) <= 256),
  ADD COLUMN dtm_key text CHECK(length(dtm_key) BETWEEN 1 AND 512);
