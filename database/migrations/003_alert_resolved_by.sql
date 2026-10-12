-- Who closed an alert: a person (operator) or the simulator when a natural anomaly recovers.
ALTER TABLE alerts ADD COLUMN resolved_by text CHECK(resolved_by IN ('operator','auto_recovery'));
UPDATE alerts SET resolved_by='operator' WHERE status='resolved';
ALTER TABLE alerts ADD CONSTRAINT alerts_resolved_by_status
  CHECK((status='active' AND resolved_by IS NULL) OR (status='resolved' AND resolved_by IS NOT NULL));
