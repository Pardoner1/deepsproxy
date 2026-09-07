import test from 'node:test';
import assert from 'node:assert';
import { app } from './index.ts';
import { GeminiWebProvider } from './services/gemini.web.ts';
import { _setGeminiProvider } from './routes/chat.ts';

class FakeGeminiProvider extends GeminiWebProvider {
  async initialize(): Promise<void> {}
  async sendMessage(prompt: string): Promise<string> {
    return 'Resposta fake do Gemini';
  }
}

test('models endpoint includes gemini models', async () => {
  const req = new Request('http://localhost/v1/models');
  const res = await app.fetch(req);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  const ids = body.data.map((m: any) => m.id);
  assert.ok(ids.includes('gemini-pro'));
  assert.ok(ids.includes('gemini-2.0-flash'));
  assert.ok(ids.includes('deepseek-v4-flash'), 'DeepSeek models must be preserved');
});

test('gemini non-stream returns OpenAI JSON with content', async () => {
  _setGeminiProvider(new FakeGeminiProvider());
  try {
    const req = new Request('http://localhost/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-pro',
        messages: [{ role: 'user', content: 'oi' }],
        stream: false
      })
    });
    const res = await app.fetch(req);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.object, 'chat.completion');
    assert.strictEqual(body.choices[0].message.role, 'assistant');
    assert.strictEqual(body.choices[0].message.content, 'Resposta fake do Gemini');
    assert.strictEqual(body.choices[0].finish_reason, 'stop');
    assert.ok(body.usage.prompt_tokens > 0);
  } finally {
    _setGeminiProvider(null);
  }
});

test('gemini streaming returns SSE with content delta', async () => {
  _setGeminiProvider(new FakeGeminiProvider());
  try {
    const req = new Request('http://localhost/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-1.5-flash',
        messages: [{ role: 'user', content: 'oi' }],
        stream: true
      })
    });
    const res = await app.fetch(req);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('Content-Type'), 'text/event-stream');

    const text = await res.text();
    assert.ok(text.includes('"content":"Resposta fake do Gemini"'));
    assert.ok(text.includes('data: [DONE]'));
  } finally {
    _setGeminiProvider(null);
  }
});
