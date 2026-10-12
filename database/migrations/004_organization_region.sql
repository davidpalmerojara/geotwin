-- Place name shown by the interface, so the code does not hard-code a city.
ALTER TABLE organizations ADD COLUMN region text CHECK(length(region) BETWEEN 1 AND 100);
