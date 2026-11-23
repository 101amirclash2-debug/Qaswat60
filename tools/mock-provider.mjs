/**
 * DEV ONLY — a tiny OpenAI-compatible mock provider.
 *
 * Purpose: exercise the full agent loop (plan → bridge exec → observation →
 * report) without spending provider credits or needing a key. It is *not*
 * shipped to users, never imported by the web app, and the UI has no
 * "simulation mode" switch.
 *
 *   node tools/mock-provider.mjs --port 8181
 *
 * Then in QASWARA settings: provider = "مزوّد مخصص",
 * base URL = http://127.0.0.1:8181/v1, model = mock-agent, key = anything.
 */

import http from 'node:http';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '8181' },
    host: { type: 'string', default: '0.0.0.0' }
  }
});
const port = Number(values.port) || 8181;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Jarvis-Token',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Private-Network': 'true'
};

function reply(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    ...CORS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

/** Decide the next step from the transcript. */
function decide(messages) {
  const userTurns = messages.filter((m) => m.role === 'user');
  const observations = userTurns.filter((m) => String(m.content).startsWith('OBSERVATION'));
  const userAsk = userTurns[0]?.content || '';

  if (observations.length === 0) {
    return JSON.stringify({
      thought: 'أبدأ بفحص بيئة الهاتف عبر الجسر.',
      action: {
        tool: 'exec',
        args: { code: 'uname -a; echo "---"; pwd; echo "---"; ls -la', lang: 'bash', timeout: 20 }
      }
    });
  }

  if (observations.length === 1) {
    return JSON.stringify({
      thought: 'أتحقق من توفر أدوات إنشاء التقارير قبل أن أعد التقرير.',
      action: {
        tool: 'exec',
        args: {
          code: 'python3 - <<\'PY\'\nimport sys, platform\nprint("python", sys.version.split()[0])\nprint("machine", platform.machine())\nPY',
          lang: 'bash',
          timeout: 20
        }
      }
    });
  }

  return JSON.stringify({
    thought: 'اكتملت المعلومات المطلوبة.',
    final:
      `# تقرير التجربة (مزوّد تجريبي)\n\n` +
      `- **طلبك:** ${String(userAsk).replace(/\s+/g, ' ').slice(0, 200)}\n` +
      `- **الخطوات:** فحص النظام، ثم التحقق من Python.\n` +
      `- **النتيجة:** حلقة التنفيذ + الجسر + جمع النتائج تعمل من طرف إلى طرف.\n\n` +
      `> هذا الرد من \`tools/mock-provider.mjs\` لأغراض التطوير فقط؛ استبدله بمزوّد حقيقي في الإعدادات.`
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }
  if (req.method === 'GET' && req.url?.startsWith('/v1/models')) {
    reply(res, 200, {
      object: 'list',
      data: [{ id: 'mock-agent', object: 'model', owned_by: 'qaswara-dev' }]
    });
    return;
  }
  if (req.method !== 'POST' || !req.url?.includes('/chat/completions')) {
    reply(res, 404, { error: { message: 'not found' } });
    return;
  }

  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
    if (raw.length > 2_000_000) req.destroy();
  });
  req.on('end', () => {
    let body = {};
    try {
      body = JSON.parse(raw || '{}');
    } catch {
      reply(res, 400, { error: { message: 'bad json' } });
      return;
    }
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    // Connection test: the app only wants a tiny echo.
    const isProbe = String(lastUser?.content || '').includes('OK');
    const content = isProbe ? 'OK' : decide(messages);

    // Simulate a little latency so the UI's spinners are visible.
    setTimeout(() => {
      reply(res, 200, {
        id: `chatcmpl-mock-${Date.now()}`,
        object: 'chat.completion',
        model: body.model || 'mock-agent',
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      });
    }, 250);
  });
});

server.listen(port, values.host, () => {
  console.log(`mock provider (dev only) → http://${values.host}:${port}/v1`);
});
