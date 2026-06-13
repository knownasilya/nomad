export default `

CREATE TABLE space_settings (
  spaceId INTEGER NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  ts INTEGER,
  PRIMARY KEY (spaceId, key)
);

PRAGMA user_version = 54;
`;
