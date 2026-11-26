CREATE TABLE user_categories (
  user_id INTEGER NOT NULL REFERENCES users(id),
  category_id TEXT NOT NULL REFERENCES categories(id),
  PRIMARY KEY(user_id, category_id)
);
