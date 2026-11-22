-- Track which interview reminders have been sent, to avoid duplicate emails across cron runs.
CREATE TABLE IF NOT EXISTS interview_reminders (
    company_id TEXT NOT NULL,
    interview_at INTEGER NOT NULL,
    channel TEXT NOT NULL,
    sent_at INTEGER NOT NULL,
    PRIMARY KEY (company_id, interview_at, channel)
);
CREATE INDEX IF NOT EXISTS idx_reminders_sent_at ON interview_reminders(sent_at);
