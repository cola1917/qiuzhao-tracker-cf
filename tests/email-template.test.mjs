import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderReminderEmail } from '../src/email-template.ts';

const base = {
  name: '星河机器人', status: '一面', when: '11/23 09:00', location: '线上会议',
  roles: '具身智能算法', hoursLeft: 6, appUrl: 'https://example.com/app',
};

test('reminder email renders brand banner, info table and action buttons', () => {
  const t0 = renderReminderEmail({ ...base, type: 'd0' });
  assert.match(t0.subject, /【今日面试提醒】/);
  assert.match(t0.html, /CAREER WORKSPACE/);
  assert.match(t0.html, /距开始约/);
  assert.match(t0.html, /打开工作台/);
  assert.match(t0.html, /https:\/\/example.com\/app/);

  const t1 = renderReminderEmail({ ...base, type: 't1', hoursLeft: 30 });
  assert.match(t1.subject, /【明日面试提醒】/);
  assert.match(t1.html, /明天/);
  assert.match(t1.html, /今晚可以再过一遍/);
});

test('meeting button links to a valid http(s) location and escapes HTML', () => {
  const withUrl = renderReminderEmail({ ...base, type: 'd0', location: 'https://meet.example.com/room/1' });
  assert.match(withUrl.html, /查看会议链接/);
  assert.match(withUrl.html, /https:\/\/meet.example.com\/room\/1/);

  const evil = renderReminderEmail({ ...base, type: 'd0', name: '<img src=x onerror=alert(1)>', location: 'javascript:alert(1)' });
  assert.doesNotMatch(evil.html, /<img src=x/);
  assert.match(evil.html, /&lt;img src=x/);
  assert.doesNotMatch(evil.html, /查看会议链接/); // javascript: URL is not linked
});
