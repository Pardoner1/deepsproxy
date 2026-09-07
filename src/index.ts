/*
 * File: index.ts
 * Project: deepsproxy
 * Author: Pedro Farias
 * Created: 2026-05-09
 * 
 * Last Modified: Sat May 09 2026
 * Modified By: Pedro Farias
 */

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { chatCompletions } from './routes/chat.ts';
import * as dotenv from 'dotenv';
import { initPlaywright, closePlaywright } from './services/playwright.ts';
import { getContextLength } from './services/telemetry.ts';
import { getConfig } from './utils/config.ts';
import { GeminiWebProvider } from './services/gemini.web.ts';

dotenv.config();

export const app = new Hono();

function modelEntry(id: string) {
  const dynamicLimit = getContextLength(id);
  return {
    id,
    object: 'model',
    created: Math.floor(Date.now() / 1000),
    owned_by: 'deepseek',
    permission: [],
    root: id,
    parent: null,
    context_length: dynamicLimit,
    max_context_tokens: dynamicLimit,
    max_input_tokens: dynamicLimit,
    max_output_tokens: 8_000,
  };
}

app.use('*', cors());

app.use('*', async (c, next) => {
  const apiKey = process.env.API_KEY;
  if (apiKey) {
    const authHeader = c.req.header('Authorization');
    const xApiKey = c.req.header('X-API-Key');
    const providedKey = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : xApiKey;
    if (!providedKey || providedKey !== apiKey) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
  }
  await next();
});

// Basic health check
app.get('/health', (c) => c.json({ status: 'ok' }));

// OpenAI compatible routes
app.post('/v1/chat/completions', chatCompletions);

app.get('/v1/models', (c) => {
  return c.json({
    object: 'list',
    data: [
      modelEntry('deepseek-v4-flash'),
      modelEntry('deepseek-v4-flash-thinking'),
      modelEntry('deepseek-v4-pro'),
      modelEntry('deepseek-v4-pro-thinking'),
      modelEntry('gemini-pro'),
      modelEntry('gemini-1.5-pro'),
      modelEntry('gemini-1.5-flash'),
      modelEntry('gemini-2.0-flash')
    ]
  });
});

// Initialize the active provider's browser when the server starts
import { fileURLToPath } from 'url';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { PROVIDER } = getConfig();

  const boot = PROVIDER === 'deepseek'
    ? initPlaywright()
    : new GeminiWebProvider().initialize();

  boot.then(() => {
    console.log(`${PROVIDER.toUpperCase()} provider initialized.`);
    const port = getConfig().PORT;
    console.log(`Server is running on port ${port}`);

    serve({
      fetch: app.fetch,
      port
    });
  }).catch((err: any) => {
    console.error(`Failed to initialize ${PROVIDER} provider:`, err);
    process.exit(1);
  });

  process.on('SIGINT', async () => {
    await closePlaywright().catch(() => {});
    process.exit(0);
  });
}
