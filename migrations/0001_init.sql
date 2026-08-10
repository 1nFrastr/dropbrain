CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('text', 'url')),
  title TEXT NOT NULL,
  body_md TEXT NOT NULL,
  url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE quizzes (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE questions (
  id TEXT PRIMARY KEY,
  quiz_id TEXT NOT NULL REFERENCES quizzes(id),
  stem TEXT NOT NULL,
  options_json TEXT NOT NULL,
  correct_index INTEGER NOT NULL CHECK (correct_index BETWEEN 0 AND 3),
  explanation TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX questions_quiz_id_idx ON questions(quiz_id);

CREATE TABLE attempts (
  id TEXT PRIMARY KEY,
  quiz_id TEXT NOT NULL REFERENCES quizzes(id),
  session_id TEXT NOT NULL,
  score REAL NOT NULL,
  answers_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX attempts_quiz_id_idx ON attempts(quiz_id);
CREATE INDEX attempts_session_id_idx ON attempts(session_id);
