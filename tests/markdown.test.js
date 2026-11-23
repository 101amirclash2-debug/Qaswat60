import test from 'node:test';
import assert from 'node:assert/strict';

import { renderMarkdown, escapeHtml, plainPreview } from '../web/js/markdown.js';

test('raw HTML from the model is escaped, never executed', () => {
  const html = renderMarkdown('<script>alert("xss")</script>\n\n<img src=x onerror=alert(1)>');
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
  assert.match(html, /&lt;script&gt;/);
});

test('a fenced code block keeps its content escaped and marks the language block', () => {
  const html = renderMarkdown('```bash\nrm -rf /tmp/x && echo "<b>"\n```');
  assert.match(html, /<pre><code>/);
  assert.match(html, /&lt;b&gt;/);
  assert.ok(!html.includes('<b>'));
});

test('bold, inline code and headings render', () => {
  const html = renderMarkdown('## تقرير\n\nتم **بنجاح** مع `exit=0`');
  assert.match(html, /<h4>تقرير<\/h4>/);
  assert.match(html, /<strong>بنجاح<\/strong>/);
  assert.match(html, /<code>exit=0<\/code>/);
});

test('dangerous link schemes are neutralised while https links survive', () => {
  const js = renderMarkdown('[اضغط](javascript:alert(1))');
  assert.ok(!js.includes('href="javascript'));
  const ok = renderMarkdown('[مصدر](https://example.com/a?b=1&c=2)');
  assert.match(ok, /href="https:\/\/example\.com\/a\?b=1&amp;c=2"/);
  assert.match(ok, /rel="noopener noreferrer nofollow"/);
});

test('lists, quotes and rules render without breaking the paragraph flow', () => {
  const html = renderMarkdown('- أولاً\n- ثانياً\n\n> ملاحظة\n\n---');
  assert.match(html, /<ul>/);
  assert.equal((html.match(/<li>/g) || []).length, 2);
  assert.match(html, /<blockquote>ملاحظة<\/blockquote>/);
  assert.match(html, /<hr>/);
});

test('unterminated code fence still renders safely', () => {
  const html = renderMarkdown('```\necho hi');
  assert.match(html, /<pre><code>echo hi<\/code><\/pre>/);
});

test('escapeHtml handles quotes and plainPreview collapses whitespace', () => {
  assert.equal(escapeHtml(`a"'&<>`), 'a&quot;&#39;&amp;&lt;&gt;');
  assert.equal(plainPreview('  many\n\nlines  ', 100), 'many lines');
  assert.equal(plainPreview('x'.repeat(50), 10), 'xxxxxxxxxx…');
});
