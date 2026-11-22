import { test } from 'node:test';
import assert from 'node:assert/strict';
import { environment, request, company } from './helpers.mjs';
import { sendReminders } from '../src/worker.ts';

const atIn = (hours) => new Date(Date.now() + hours * 3600000).toISOString();

test('scheduled email reminders only cover upcoming interviews and never duplicate', async () => {
    const env = environment();
    const soon = atIn(6), far = atIn(200);
    await request(env, '/api/data', 'PUT', { revision: 0, roles: [], companies: [
        { ...company('soon'), status: '一面', interview: { phase: 'scheduled', at: soon, location: '会议链接 A' } },
        { ...company('far'), status: '二面', interview: { phase: 'scheduled', at: far, location: '会议链接 B' } },
    ] });

    const sent = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
        sent.push({ url, body: JSON.parse(opts.body) });
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    try {
        env.RESEND_API_KEY = 're_test';
        env.NOTIFY_EMAIL = 'me@example.com';
        await sendReminders(env, Date.now());
        assert.equal(sent.length, 1, 'only the interview within 48h should be emailed');
        assert.equal(sent[0].body.to, 'me@example.com');
        assert.match(sent[0].body.subject, /soon/);
        assert.equal(env.DB.db.prepare('SELECT COUNT(*) AS n FROM interview_reminders').get().n, 1);

        // A second run must not send a duplicate for the same interview.
        sent.length = 0;
        await sendReminders(env, Date.now());
        assert.equal(sent.length, 0, 'duplicate reminder should be skipped');
    } finally {
        globalThis.fetch = realFetch;
    }
});

test('reminders are a no-op without Resend configuration', async () => {
    const env = environment();
    await request(env, '/api/data', 'PUT', { revision: 0, roles: [], companies: [
        { ...company('a'), status: '一面', interview: { phase: 'scheduled', at: atIn(6), location: '' } },
    ] });
    const realFetch = globalThis.fetch;
    let called = false;
    globalThis.fetch = async () => { called = true; return new Response('{}', { status: 200 }); };
    try {
        await sendReminders(env, Date.now());
        assert.equal(called, false, 'no email should be sent without RESEND_API_KEY / NOTIFY_EMAIL');
    } finally {
        globalThis.fetch = realFetch;
    }
});
