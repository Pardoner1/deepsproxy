/*
 * File: deepseek.web.ts
 * Project: deepsproxy
 * DeepSeek web provider adapted to the BaseWebProvider interface.
 *
 * The original DeepSeek data path (Playwright PoW header interception +
 * direct fetch to chat.deepseek.com/api/v0/chat/completion) is preserved
 * verbatim in ./playwright.ts and ./deepseek.ts. This class adapts that flow
 * to the shared provider interface used by login and the provider factory.
 */

import { BaseWebProvider } from './base.web.ts';
import { initPlaywright, closePlaywright, activePage } from './playwright.ts';
import { createDeepSeekStream } from './deepseek.ts';

const DEEPSEEK_URL = 'https://chat.deepseek.com/';

export class DeepSeekWebProvider extends BaseWebProvider {
  private readonly DEEPSEEK_URL = DEEPSEEK_URL;

  constructor() {
    super();
    this.providerName = 'DeepSeek';
  }

  /**
   * DeepSeek login is interactive: open the browser and let the user sign in.
   * The persistent profile (deepseek_profile/) keeps the session alive.
   */
  async login(): Promise<void> {
    console.log('[DeepSeek] Opening browser for manual login...');
    await initPlaywright(false);
    if (activePage) {
      await activePage.goto(this.DEEPSEEK_URL, { waitUntil: 'domcontentloaded' });
    }
    console.log('[DeepSeek] Log in on chat.deepseek.com, then close the browser or press Ctrl+C.');
    await new Promise<void>((resolve) => {
      process.once('SIGINT', async () => {
        await closePlaywright();
        resolve();
      });
    });
  }

  /**
   * Sends a message through the original DeepSeek streaming flow and returns
   * the accumulated raw response text. The HTTP route uses the streaming path
   * directly (see routes/chat.ts); this method exists to satisfy the shared
   * provider interface.
   */
  async sendMessage(prompt: string): Promise<string> {
    const { stream } = await createDeepSeekStream(prompt, false, false, null);
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let raw = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      raw += decoder.decode(value, { stream: true });
    }
    if (!raw) throw new Error('DeepSeek returned an empty response');
    return raw;
  }

  async isLoggedIn(): Promise<boolean> {
    return this.hasSavedSession();
  }

  getAvailableModels(): string[] {
    return ['deepseek-v4-flash', 'deepseek-v4-flash-thinking', 'deepseek-v4-pro', 'deepseek-v4-pro-thinking'];
  }
}