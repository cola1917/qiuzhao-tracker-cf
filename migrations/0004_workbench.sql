ALTER TABLE companies ADD COLUMN starred INTEGER NOT NULL DEFAULT 0;
ALTER TABLE companies ADD COLUMN deleted_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE companies ADD COLUMN interview TEXT NOT NULL DEFAULT '{"phase":"pending","at":"","location":""}';
CREATE TABLE company_history (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    from_status TEXT NOT NULL DEFAULT '',
    to_status TEXT NOT NULL DEFAULT '',
    detail TEXT NOT NULL DEFAULT '',
    occurred_at INTEGER NOT NULL,
    recorded_at INTEGER NOT NULL
);
CREATE INDEX idx_history_company ON company_history(company_id, occurred_at DESC);
INSERT INTO company_history(id,company_id,kind,to_status,detail,occurred_at,recorded_at)
SELECT lower(hex(randomblob(16))),id,'baseline',status,'历史记录启用时的状态',unixepoch()*1000,unixepoch()*1000 FROM companies;
