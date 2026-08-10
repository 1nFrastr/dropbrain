-- Speeds up URL source cache lookups
CREATE INDEX IF NOT EXISTS sources_url_idx ON sources(url);
