-- Existing expenses remain unlinked. User overrides never modify the shared catalog.
ALTER TABLE expenses ADD COLUMN merchant_id TEXT;
CREATE TABLE user_merchants (
  user_id INTEGER NOT NULL REFERENCES users(id),
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  aliases TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0 CHECK(hidden IN (0,1)),
  PRIMARY KEY(user_id,id)
);
