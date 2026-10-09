-- 初始化表结构
CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    link TEXT NOT NULL DEFAULT '',
    deadline TEXT NOT NULL DEFAULT '',
    roles TEXT NOT NULL DEFAULT '[]',
    dept TEXT NOT NULL DEFAULT '',
    applied_at TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT '未投',
    note TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE IF NOT EXISTS roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_companies_status ON companies(status);
CREATE INDEX IF NOT EXISTS idx_companies_deadline ON companies(deadline);
CREATE INDEX IF NOT EXISTS idx_companies_name ON companies(name);

-- 插入默认岗位
INSERT OR IGNORE INTO roles (name, sort_order) VALUES
('具身智能算法', 1),
('机器人算法', 2),
('VLA / 多模态算法', 3),
('机器人仿真', 4),
('Sim2Real', 5),
('感知算法', 6),
('SLAM / 定位', 7),
('运动规划', 8),
('运动控制', 9),
('强化学习', 10),
('大模型算法', 11),
('AI Infra', 12),
('端侧部署', 13),
('机械工程师', 14),
('结构工程师', 15),
('软件开发', 16);

-- 触发器：自动更新 updated_at
CREATE TRIGGER IF NOT EXISTS trigger_companies_updated_at
AFTER UPDATE ON companies
BEGIN
    UPDATE companies SET updated_at = strftime('%s', 'now') WHERE id = NEW.id;
END;