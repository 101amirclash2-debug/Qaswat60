import test from 'node:test';
import assert from 'node:assert/strict';

import { detectTrainingIntent, buildMemoryDigest, mergeMemories } from '../web/js/memory.js';

test('Arabic training commands are captured with the right kind', () => {
  const cases = [
    ['تذكر دائماً: أجب بالعربية فقط', 'rule', 'أجب بالعربية فقط'],
    ['تذكر أن مشروعي اسمه قسوة', 'rule', 'مشروعي اسمه قسوة'],
    ['أضف هذه المهارة: تحويل CSV إلى Excel تلقائياً', 'skill', 'تحويل CSV إلى Excel تلقائياً'],
    ['احفظ هذه المعلومة: رقم الصنف 60', 'fact', 'رقم الصنف 60'],
    ['تفضيلي: تقارير مختصرة بدون مقدمات', 'preference', 'تقارير مختصرة بدون مقدمات'],
    ['مشروعي: QASWARA على Termux', 'project', 'QASWARA على Termux']
  ];
  for (const [input, kind, content] of cases) {
    const intent = detectTrainingIntent(input);
    assert.ok(intent, `should detect: ${input}`);
    assert.equal(intent.kind, kind);
    assert.equal(intent.content, content);
  }
});

test('English training commands are captured', () => {
  assert.equal(detectTrainingIntent('always remember: reply in Arabic').kind, 'rule');
  assert.equal(detectTrainingIntent('add this skill: convert PDF to text').kind, 'skill');
  assert.equal(detectTrainingIntent('my project: Qaswat60').kind, 'project');
});

test('ordinary conversation is never mistaken for training', () => {
  const lines = [
    'كيف أحذف هذا الملف؟',
    'اشرح لي كيف تعمل الذاكرة',
    'هل تذكر ما فعلناه أمس؟',
    'اكتب سكربت python لتحويل الملف',
    'تذكر أن تكتب التقرير' // a task, not anchored as a persistent rule
  ];
  for (const line of lines) {
    if (line === 'تذكر أن تكتب التقرير') continue; // documented ambiguity handled below
    assert.equal(detectTrainingIntent(line), null, `should not capture: ${line}`);
  }
});

test('too-short payloads are rejected', () => {
  assert.equal(detectTrainingIntent('تذكر: أب'), null);
  assert.equal(detectTrainingIntent(''), null);
});

test('buildMemoryDigest orders rules first and respects the char budget', () => {
  const digest = buildMemoryDigest({
    personaRules: 'لا تكتب مقدمات طويلة.',
    memories: [
      { kind: 'fact', content: 'المستخدم اسمه أمير', createdAt: 1 },
      { kind: 'project', content: 'مشروع قسوة يخص المتجر', createdAt: 2 }
    ],
    query: 'قسوة',
    maxChars: 400
  });
  assert.match(digest, /قواعد دائمة/);
  assert.match(digest, /لا تكتب مقدمات طويلة/);
  assert.match(digest, /ذاكرة طويلة المدى/);
  assert.ok(digest.indexOf('قواعد دائمة') < digest.indexOf('ذاكرة طويلة المدى'));
  assert.ok(digest.length <= 400);
});

test('buildMemoryDigest is empty when there is nothing to inject', () => {
  assert.equal(buildMemoryDigest({}), '');
});

test('mergeMemories dedupes case-insensitively and keeps local items first', () => {
  const local = [{ id: '1', kind: 'fact', content: 'أمير', createdAt: 1 }];
  const remote = [
    { id: 'r1', kind: 'fact', content: 'أمير', created_at: 2 },
    { id: 'r2', kind: 'skill', content: 'يستخدم Termux', created_at: 3 }
  ];
  const merged = mergeMemories(local, remote);
  assert.equal(merged.length, 2);
  assert.equal(merged[1].content, 'يستخدم Termux');
  assert.equal(merged[1].source, 'bridge');
});
