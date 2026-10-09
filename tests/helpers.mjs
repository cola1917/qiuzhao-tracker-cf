import app from '../src/worker.ts';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
export function database() {
    const db = new DatabaseSync(':memory:');
    for (const name of ['0001_init.sql', '0003_sync.sql'])
        db.exec(readFileSync(new URL('../migrations/' + name, import.meta.url), 'utf8'));
    const prepare = (sql, values = []) => ({ bind: (...args) => prepare(sql, args), sql, values });
    return { db, prepare, async batch(statements) { db.exec('BEGIN'); try {
            const result = statements.map(({ sql, values }) => { const stmt = db.prepare(sql); if (stmt.columns().length)
                return { results: stmt.all(...values), meta: { changes: 0 } }; const info = stmt.run(...values); return { results: [], meta: { changes: Number(info.changes) } }; });
            db.exec('COMMIT');
            return result;
        }
        catch (e) {
            db.exec('ROLLBACK');
            throw e;
        } } };
}
export const company = (id, roles = []) => ({ id, name: id, roles, link: '', dept: '', deadline: '', appliedAt: '', status: '未投', note: '' });
export function request(env, path = '/api/data', method = 'GET', body, headers = {}) { return app.request(path, { method, headers: { Authorization: 'Bearer test-only-key', 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }, env); }
export const environment = () => ({ DB: database(), ACCESS_TOKEN: 'test-only-key' });
