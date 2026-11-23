/**
 * Unit tests for the QASWARA feature modules that do not need a DOM:
 * persona, routing, privacy, files lab, studio helpers, voice helpers, live.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { STYLES, DIALECTS, buildPersonaBlock, personaChip } from '../web/js/persona.js';
import { MODEL_CHOICES, AUTO_MODEL_ID, LIMITS, DEFAULT_SETTINGS, normalizeSettings } from '../web/js/config.js';
import { classifyTask, routeModel, applyChoice, modelLabel, choiceById } from '../web/js/models.js';
import { scrubSecrets, setInternetEnabled, assertInternet, InternetBlockedError, isInternetEnabled } from '../web/js/privacy.js';
import {
  sanitizeName,
  buildContext,
  buildQuizPrompt,
  parseQuiz,
  gradeQuiz,
  FileLab
} from '../web/js/lab.js';
import { buildPreviewDoc, formatBytes, StudioError } from '../web/js/studio.js';
import { normalizeArabic, speakableText, voiceSupport } from '../web/js/voice.js';
import { mediaSupport, describeLiveSupport } from '../web/js/live.js';

/* ---------------- persona & routing ---------------- */

test('persona: five styles and seven dialects, formal is the default', () => {
  assert.deepEqual(Object.keys(STYLES), ['formal', 'technical', 'creative', 'concise', 'colloquial']);
  assert.equal(Object.keys(DIALECTS).length, 7);
  assert.equal(DEFAULT_SETTINGS.style, 'formal');
  assert.equal(DEFAULT_SETTINGS.dialect, 'standard');
  const block = buildPersonaBlock({ style: 'colloquial', dialect: 'yemeni' });
  assert.match(block, /يمني|عدني/);
  assert.match(personaChip(DEFAULT_SETTINGS), /رسمي/);
});

test('models: Auto-Genius routes code to DeepSeek, vision to Gemini, writing to Claude', () => {
  const settings = normalizeSettings({ provider: 'gemini', apiKey: 'k', autoModel: true, modelChoice: AUTO_MODEL_ID });
  assert.equal(classifyTask('اكتب دالة python تفرز ملفات'), 'code');
  const code = routeModel({ text: 'اكتب دالة python تفرز ملفات', settings });
  assert.equal(choiceById(code.choiceId).provider, 'deepseek');

  const vision = routeModel({ text: 'ماذا في هذه الصورة؟', settings, hasImage: true });
  assert.equal(choiceById(vision.choiceId).provider, 'gemini');
  assert.equal(vision.task, 'vision');

  const writing = routeModel({ text: 'اكتب لي قصة قصيرة عن الصحراء', settings });
  assert.equal(choiceById(writing.choiceId).provider, 'openrouter');

  assert.equal(MODEL_CHOICES.length, 7);
  const applied = applyChoice(settings, 'gpt-4o');
  assert.equal(applied.provider, 'openai');
  assert.equal(applied.model, 'gpt-4o');
  assert.equal(applied.autoModel, false);
  assert.match(modelLabel(settings), /Auto-Genius/);
});

/* ---------------- privacy ---------------- */

test('privacy: secrets are scrubbed before any provider call', () => {
  const text = 'key AIzaABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 and sk-abcdefghijklmnopqrstuvwx';
  const result = scrubSecrets(text);
  assert.equal(result.redactions, 2);
  assert.doesNotMatch(result.text, /AIzaABC/);
  assert.doesNotMatch(result.text, /sk-abc/);
  assert.match(result.text, /محجوب/);
  assert.deepEqual(result.types.sort(), ['google api key', 'openai/groq key']);
});

test('privacy: the kill switch blocks outbound calls until reopened', () => {
  assert.equal(isInternetEnabled(), true);
  setInternetEnabled(false);
  assert.throws(() => assertInternet('اختبار'), InternetBlockedError);
  setInternetEnabled(true);
  assert.doesNotThrow(() => assertInternet('اختبار'));
});

/* ---------------- files lab ---------------- */

test('lab: context, prompt, quiz parsing and local grading are real', () => {
  const items = [
    { name: 'a.txt', kind: 'txt', text: 'الميزانية 120 ريال', status: 'ready' },
    { name: 'b.md', kind: 'md', text: 'ملاحظة ثانية', status: 'ready' }
  ];
  const context = buildContext(items, { maxChars: 1000 });
  assert.match(context.text, /الميزانية/);
  assert.equal(context.files, 2);

  const prompt = buildQuizPrompt(context.text, { count: 3 });
  assert.match(prompt, /JSON فقط/);
  assert.match(prompt, /3 أسئلة/);

  const parsed = parseQuiz(
    '```json\n{"questions":[{"q":"كم الميزانية؟","options":["100","120","140"],"answer":1,"explain":"من الملف"}]}\n```'
  );
  assert.equal(parsed.ok, true);
  assert.equal(parsed.questions.length, 1);

  const grade = gradeQuiz(parsed.questions, [1]);
  assert.equal(grade.correct, 1);
  assert.equal(grade.percent, 100);

  assert.equal(parseQuiz('لا يوجد شيء').ok, false);
  assert.equal(sanitizeName('تقرير/2024 مالي:Q1.xlsx').includes('/'), false);
});

test('lab: text files are read in the browser without a bridge', async () => {
  const lab = new FileLab({ bridge: null });
  const added = await lab.addFiles([
    { name: 'notes.txt', size: 10, type: 'text/plain', text: async () => 'نص محلي' }
  ]);
  assert.equal(added[0].status, 'ready');
  assert.equal(added[0].text, 'نص محلي');
  assert.match(lab.context().text, /نص محلي/);
});

/* ---------------- studio ---------------- */

test('studio: preview documents are sandbox-ready and sizes are honest', () => {
  const doc = buildPreviewDoc({ html: '<h1>مرحبا</h1>', css: 'body{background:#000}', js: 'console.log(1)', title: 'قسورة' });
  assert.match(doc, /^<!doctype html>/);
  assert.match(doc, /<h1>مرحبا<\/h1>/);
  assert.match(doc, /background:#000/);
  assert.equal(formatBytes(0), '—');
  assert.equal(formatBytes(2048), '2.0 KB');
  assert.ok(new StudioError('x') instanceof Error);
});

/* ---------------- voice ---------------- */

test('voice: Arabic normalisation matches wake words across spelling variants', () => {
  assert.equal(normalizeArabic('يَا قَسْوَرَة'), 'يا قسوره');
  assert.equal(normalizeArabic('يا قسورة!'), 'يا قسوره');
  assert.ok(normalizeArabic('أهلاً يا قسورة').includes(normalizeArabic('يا قسورة')));
  assert.match(speakableText('**عنوان**\n```js\ncode\n```'), /عنوان/);
  const support = voiceSupport({});
  assert.deepEqual(support, { tts: false, stt: false, wake: false });
});

/* ---------------- live ---------------- */

test('live: capability detection explains what the device cannot do', () => {
  const support = mediaSupport({ navigator: {} });
  assert.equal(support.camera, false);
  const described = describeLiveSupport(support);
  assert.equal(described.find((d) => d.id === 'camera').ok, false);
  assert.match(described.find((d) => d.id === 'screen').reason, /getDisplayMedia/);
  assert.equal(LIMITS.voiceRate.min, 0.5);
});
