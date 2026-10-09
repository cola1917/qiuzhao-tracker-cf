import { test } from 'node:test';
import assert from 'node:assert/strict';
import { environment, request, company } from './helpers.mjs';
test('API requires configured secret and valid credentials', async () => { const env = environment(); assert.equal((await request({ ...env, ACCESS_TOKEN: undefined })).status, 503); assert.equal((await request(env, '/api/data', 'GET', undefined, { Authorization: '' })).status, 401); assert.equal((await request(env)).status, 200); });
test('snapshot replacement deletes absent rows, preserves roles and accepts empty state', async () => { const env = environment(); let data = { revision: 0, roles: ['自定义'], companies: [company('a', ['自定义']), company('b')] }; assert.equal((await request(env, '/api/data', 'PUT', data)).status, 200); let loaded = await (await request(env)).json(); assert.deepEqual(loaded.roles, ['自定义']); assert.equal(loaded.companies.length, 2); data = { ...loaded, companies: [loaded.companies[0]] }; assert.equal((await request(env, '/api/data', 'PUT', data)).status, 200); loaded = await (await request(env)).json(); assert.deepEqual(loaded.companies.map(c => c.id), ['a']); assert.equal((await request(env, '/api/data', 'PUT', { ...loaded, roles: [], companies: [] })).status, 200); loaded = await (await request(env)).json(); assert.deepEqual(loaded.roles, []); assert.deepEqual(loaded.companies, []); });
test('stale device cannot overwrite newer data or roles', async () => { const env = environment(); const first = { revision: 0, roles: ['R'], companies: [company('a', ['R'])] }; await request(env, '/api/data', 'PUT', first); assert.equal((await request(env, '/api/data', 'PUT', { revision: 0, roles: [], companies: [] })).status, 409); const loaded = await (await request(env)).json(); assert.equal(loaded.revision, 1); assert.deepEqual(loaded.roles, ['R']); assert.equal(loaded.companies[0].id, 'a'); });
test('role deletion removes associations atomically using standard SQLite', async () => { const env = environment(); await request(env, '/api/data', 'PUT', { revision: 0, roles: ['R'], companies: [company('a', ['R'])] }); assert.equal((await request(env, '/api/roles/R', 'DELETE', undefined, { 'If-Match': '1' })).status, 200); const loaded = await (await request(env)).json(); assert.deepEqual(loaded.roles, []); assert.deepEqual(loaded.companies[0].roles, []); });
test('invalid ids, dates, duplicate IDs, shapes and statuses are rejected without writes', async () => { for (const co of [{ ...company('a'), id: 'x" onfocus="alert(1)' }, { ...company('a'), deadline: '2026-02-30' }, { ...company('a'), roles: ['missing'] }, { ...company('a'), status: 'bad' }, null]) {
    const env = environment();
    assert.equal((await request(env, '/api/data', 'PUT', { revision: 0, roles: [], companies: [co] })).status, 400);
    assert.equal((await (await request(env)).json()).revision, 0);
} const env = environment(); assert.equal((await request(env, '/api/data', 'PUT', { revision: 0, roles: [], companies: [company('a'), company('a')] })).status, 400); });
test('transaction failure rolls back version and original records', async () => { const env = environment(); await request(env, '/api/data', 'PUT', { revision: 0, roles: [], companies: [company('a')] }); env.DB.db.exec("CREATE TRIGGER fail_insert BEFORE INSERT ON companies WHEN NEW.name = 'fail' BEGIN SELECT RAISE(ABORT, 'test rollback'); END;"); const result = await request(env, '/api/data', 'PUT', { revision: 1, roles: [], companies: [company('fail')] }); assert.equal(result.status, 500); const loaded = await (await request(env)).json(); assert.equal(loaded.revision, 1); assert.equal(loaded.companies[0].id, 'a'); });
test('company ordering survives round trip', async () => { const env = environment(); await request(env, '/api/data', 'PUT', { revision: 0, roles: [], companies: [company('z'), company('a'), company('m')] }); assert.deepEqual((await (await request(env)).json()).companies.map(c => c.id), ['z', 'a', 'm']); });

test('legacy seed import does not overwrite existing user edits', async () => {
    const { readFileSync } = await import('node:fs');
    const env = environment();
    const seed = readFileSync(new URL('../migrations/0002_import_data.sql', import.meta.url), 'utf8');
    env.DB.db.exec(seed);
    const original = env.DB.db.prepare('SELECT id FROM companies LIMIT 1').get();
    env.DB.db.prepare('UPDATE companies SET note = ? WHERE id = ?').run('preserve current user note', original.id);
    env.DB.db.exec(seed);
    assert.equal(env.DB.db.prepare('SELECT note FROM companies WHERE id = ?').get(original.id).note, 'preserve current user note');
});
