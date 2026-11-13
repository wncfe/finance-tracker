CREATE TABLE companion_pairings (
 code TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL
);
CREATE TABLE companion_devices (
 id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), name TEXT NOT NULL,
 token TEXT NOT NULL UNIQUE, expires INTEGER NOT NULL, created INTEGER NOT NULL
);
CREATE INDEX companion_devices_user ON companion_devices(user_id);
CREATE TABLE companion_inbox (
 user_id INTEGER NOT NULL REFERENCES users(id), id TEXT NOT NULL, device_id TEXT NOT NULL,
 payload TEXT NOT NULL, raw_text TEXT NOT NULL, items TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','dismissed')),
 created INTEGER NOT NULL, review_payload TEXT,
 PRIMARY KEY(user_id,id)
);
CREATE INDEX companion_inbox_pending ON companion_inbox(user_id,status,created);
