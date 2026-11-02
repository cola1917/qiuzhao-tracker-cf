-- Consolidate equivalent role labels without changing record positions or edit times.
CREATE TABLE role_merge_aliases(alias TEXT PRIMARY KEY, canonical TEXT NOT NULL);
INSERT INTO role_merge_aliases(alias,canonical) VALUES
('具身智能算法工程师','具身智能算法'),
('视觉与具身智能算法工程师','具身智能算法'),
('机器人研发工程师（具身智能与AI算法）','具身智能算法'),
('机器人算法研究员','机器人算法'),
('机器人感知','感知算法'),
('机器人3D感知算法','感知算法'),
('具身感知算法','感知算法'),
('3DGS','三维重建算法'),
('数据科学工程','数据科学'),
('机器人仿真','仿真开发'),
('仿真开发工程师','仿真开发'),
('物理仿真','仿真开发'),
('用户体验-大模型算法','大模型算法'),
('智驾仿真开发工程师','智驾仿真开发'),
('算子开发与优化工程师','算子开发与优化'),
('算法评测工程师','算法评测'),
('数据挖掘工程师','数据挖掘'),
('定位与空间感知算法工程师','定位与空间感知算法'),
('机器人研发工程师（感知与导航算法）','感知与导航算法'),
('具身智能算法工程师（仿真重建方向）','具身智能算法（仿真重建）'),
('Infra算法工程师（三维重建方向）','三维重建算法（Infra）'),
('测试开发工程师（三维重建方向）','测试开发（三维重建）'),
('测试开发工程师（智驾）','测试开发（智驾）');
UPDATE sync_meta SET revision=revision+1, write_token=lower(hex(randomblob(16))) WHERE id=1;
CREATE TABLE role_merge_staging AS
SELECT COALESCE(a.canonical,r.name) AS name, min(r.sort_order) AS sort_order
FROM roles r LEFT JOIN role_merge_aliases a ON a.alias=r.name GROUP BY COALESCE(a.canonical,r.name);
DELETE FROM roles;
INSERT INTO roles(name,sort_order) SELECT name,sort_order FROM role_merge_staging ORDER BY sort_order;
DROP TRIGGER IF EXISTS trigger_companies_updated_at;
UPDATE companies SET roles=(
 SELECT json_group_array(name) FROM (
 SELECT COALESCE(a.canonical,j.value) AS name, min(CAST(j.key AS INTEGER)) AS first_seen
 FROM json_each(companies.roles) j LEFT JOIN role_merge_aliases a ON a.alias=j.value
 GROUP BY COALESCE(a.canonical,j.value) ORDER BY first_seen
 ));
CREATE TRIGGER trigger_companies_updated_at AFTER UPDATE ON companies
BEGIN
 UPDATE companies SET updated_at = strftime('%s', 'now') WHERE id = NEW.id;
END;
DROP TABLE role_merge_staging;
DROP TABLE role_merge_aliases;
