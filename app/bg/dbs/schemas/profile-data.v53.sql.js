export default `

CREATE TABLE spaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  icon TEXT DEFAULT 'circle',
  color TEXT DEFAULT '#6c6cff',
  partition TEXT NOT NULL UNIQUE,
  root_drive_url TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

INSERT INTO spaces (id, name, icon, color, partition, created_at)
  VALUES (1, 'Personal', 'home', '#6c6cff', '', (strftime('%s', 'now') * 1000));

ALTER TABLE visits ADD COLUMN spaceId INTEGER DEFAULT 1;

PRAGMA user_version = 53;
`;
