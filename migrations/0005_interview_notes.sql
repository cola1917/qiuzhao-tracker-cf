CREATE TABLE interview_notes (
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL, event_id TEXT NOT NULL,
 stage TEXT NOT NULL, meeting_at TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '',
 body TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '复盘', updated_at INTEGER NOT NULL
);
CREATE INDEX idx_notes_company ON interview_notes(company_id);
