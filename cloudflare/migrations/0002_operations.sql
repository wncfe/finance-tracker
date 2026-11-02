CREATE TABLE operations (
 user INTEGER NOT NULL REFERENCES users(id),
 id TEXT NOT NULL,
 payload TEXT NOT NULL,
 PRIMARY KEY(user, id)
);
