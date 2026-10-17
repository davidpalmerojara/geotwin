-- When an operator acknowledged an active alert («Reconocer»): the scene stops its pulse, the
-- beam stays until the alert is resolved. An escalation clears it (it needs a new look).
ALTER TABLE alerts ADD COLUMN acknowledged_at timestamptz;
