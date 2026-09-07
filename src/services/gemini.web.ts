/*
 * File: gemini.web.ts
 * Project: deepsproxy
 * Gemini web-scraping provider built on top of BaseWebProvider.
 *
 * Drives https://gemini.google.com with Playwright. Sessions are persisted in
 * ./gemini_profile/ so the user does not need to log in on every request.
 *
 * The response extractor uses targeted assistant-message selectors plus a
 * text-cleanup pass that strips UI chrome (buttons, menus, shortcut hints) so
 * only the real assistant content is returned.
 */

import { BaseWebProvider } from './base.web.ts';
import { getConfig } from '../utils/config.ts';

const GEMINI_URL = 'https://gemini.google.com/';

// Selectors for the prompt input, resilient to UI changes.
const PROMPT_TEXTAREA =
  'textarea[placeholder*="Ask Gemini"], textarea[placeholder*="Pergunte"], ' +
  'textarea[placeholder*="Perguntar"], textarea[aria-label*="Ask"], ' +
  'textarea[aria-label*="Pergunte"], textarea[aria-label*="Prompt"], ' +
  'rich-textarea[aria-label*="Prompt"], textarea, [role="textbox"]';

// Selectors for the "Stop generating" button (visible while streaming).
const STOP_BUTTON =
  'button[aria-label*="Stop"], button[data-testid="stop-button"], ' +
  'button[aria-label*="Parar"], button[aria-label*="Stop generating"]';

// Selectors for assistant (model) response messages.
const ASSISTANT_SELECTORS = [
  '[data-message-type="assistant"]',
  '[data-testid="assistant-message"]',
  '.message-content.assistant',
  '.model-response-text',
  '.conversation-item [data-message-type="assistant"]',
  'div[role="article"] .text-content',
  '.text-body-large',
  '.gemini-response',
  '.assistant-response',
  '.response-content',
];

export class GeminiWebProvider extends BaseWebProvider {
  private readonly GEMINI_URL = GEMINI_URL;

  constructor() {
    super();
    this.providerName = 'Gemini';
  }

  async login(email?: string, password?: string): Promise<void> {
    if (!this.page) throw new Error('Browser not initialized');

    console.log('[Gemini] Verificando login...');
    await this.page.goto(this.GEMINI_URL, { waitUntil: 'domcontentloaded' });
    await this.page.waitForTimeout(3000);

    if (await this.isLoggedIn()) {
      console.log('[Gemini] Already signed in.');
      await this.saveSession();
      return;
    }

    const cfg = getConfig();
    const userEmail = email ?? cfg.GEMINI_EMAIL;
    const userPassword = password ?? cfg.GEMINI_PASSWORD;

    if (!userEmail || !userPassword) {
      // Manual login fallback: the browser was opened non-headless by
      // login:gemini, so let the user complete the sign-in by hand.
      console.warn(
        '[Gemini] GEMINI_EMAIL/GEMINI_PASSWORD not set. Complete the login manually in ' +
          'the opened browser window; the session will be persisted.'
      );
      await this.waitForChatReady(120000).catch(() => {});
      await this.saveSession();
      return;
    }

    console.log('[Gemini] Realizando login...');

    // Click the "Sign in" entry point if present.
    const signInSelectors = [
      'button:has-text("Sign in")',
      'a:has-text("Sign in")',
      '[data-testid="sign-in"]',
      'button:has-text("Fazer login")',
      'a:has-text("Entrar")',
    ];
    let signInClicked = false;
    for (const selector of signInSelectors) {
      try {
        const btn = await this.page.waitForSelector(selector, { timeout: 5000 });
        if (btn) {
          await btn.click();
          signInClicked = true;
          break;
        }
      } catch {
        // try next selector
      }
    }

    if (!signInClicked) {
      throw new Error('Não foi possível encontrar o botão de login');
    }

    await this.page.waitForTimeout(2000);

    // Fill Google account email.
    const emailSelectors = [
      'input[type="email"]',
      'input[aria-label*="Email"]',
      'input[aria-label*="E-mail"]',
      'input[name="identifier"]',
    ];
    let emailFilled = false;
    for (const selector of emailSelectors) {
      try {
        const input = await this.page.waitForSelector(selector, { timeout: 5000 });
        if (input) {
          await input.fill(userEmail);
          emailFilled = true;
          break;
        }
      } catch {
        // try next selector
      }
    }

    if (!emailFilled) {
      throw new Error('Não foi possível preencher o email');
    }

    await this.page.waitForTimeout(1000);
    await this.page.click('button:has-text("Next"), button:has-text("Próximo")');
    await this.page.waitForTimeout(2000);

    // Fill Google account password.
    const passwordSelectors = [
      'input[type="password"]',
      'input[aria-label*="Password"]',
      'input[aria-label*="Senha"]',
      'input[name="Passwd"]',
    ];
    let passwordFilled = false;
    for (const selector of passwordSelectors) {
      try {
        const input = await this.page.waitForSelector(selector, { timeout: 5000 });
        if (input) {
          await input.fill(userPassword);
          passwordFilled = true;
          break;
        }
      } catch {
        // try next selector
      }
    }

    if (!passwordFilled) {
      throw new Error('Não foi possível preencher a senha');
    }

    await this.page.waitForTimeout(1000);
    await this.page.click('button:has-text("Next"), button:has-text("Próximo")');
    await this.page.waitForTimeout(3000);

    // Wait for the chat interface to load.
    await this.waitForChatReady(15000).catch(() => {
      console.warn('[Gemini] Não foi possível detectar a interface do chat, mas continuando...');
    });

    await this.saveSession();
    console.log('✅ Login Gemini realizado com sucesso!');
  }

  async sendMessage(prompt: string): Promise<string> {
    if (!this.page) throw new Error('Browser not initialized');

    await this.loadSession();
    await this.page.goto(this.GEMINI_URL, { waitUntil: 'domcontentloaded' });
    await this.page.waitForTimeout(3000);

    if (!(await this.isLoggedIn())) {
      throw new Error('Não está logado no Gemini. Execute npm run login:gemini');
    }

    // Clear any previous chat so the response is fresh.
    await this.startNewChat();

    // Find and fill the prompt input.
    const textarea = await this.findPromptInput();
    if (!textarea) {
      throw new Error('Não foi possível encontrar o campo de texto do Gemini');
    }

    await textarea.click();
    await textarea.fill(prompt);
    await this.page.waitForTimeout(500);

    await this.page.keyboard.press('Enter');
    console.log('[Gemini] Prompt enviado, aguardando resposta...');

    return this.waitForGeminiResponse();
  }

  async isLoggedIn(): Promise<boolean> {
    try {
      if (!this.page) return false;
      await this.page.goto(this.GEMINI_URL, { waitUntil: 'domcontentloaded' });
      await this.page.waitForTimeout(2000);

      const hasTextarea = await this.page.$(PROMPT_TEXTAREA);
      const hasLoginButton = await this.page.$(
        'button:has-text("Sign in"), button:has-text("Fazer login")'
      );

      return !!hasTextarea && !hasLoginButton;
    } catch {
      return false;
    }
  }

  getAvailableModels(): string[] {
    return ['gemini-pro', 'gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.0-flash'];
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  private async startNewChat(): Promise<void> {
    if (!this.page) return;
    const newChatSelectors = [
      'button[aria-label*="New chat"]',
      'button[aria-label*="Novo chat"]',
      'button[data-testid="new-chat"]',
    ];
    for (const selector of newChatSelectors) {
      try {
        const btn = await this.page.$(selector);
        if (btn) {
          await btn.click();
          await this.page.waitForTimeout(1000);
          return;
        }
      } catch {
        // try next selector
      }
    }
  }

  private async findPromptInput() {
    if (!this.page) return null;
    const selectors = [
      'textarea[placeholder*="Ask Gemini"]',
      'textarea[placeholder*="Pergunte"]',
      'textarea[placeholder*="Perguntar"]',
      '[contenteditable="true"]',
      '[role="textbox"]',
    ];
    for (const selector of selectors) {
      try {
        const el = await this.page.waitForSelector(selector, { timeout: 10000 });
        if (el) return el;
      } catch {
        // try next selector
      }
    }
    return null;
  }

  private async waitForChatReady(timeout: number): Promise<void> {
    if (!this.page) return;
    await this.page.waitForSelector(PROMPT_TEXTAREA, { timeout });
  }

  private async waitForGeminiResponse(timeout: number = 120000): Promise<string> {
    if (!this.page) throw new Error('Browser not initialized');

    // Wait for the "Stop" button to disappear (generation finished).
    try {
      await this.page.waitForSelector(STOP_BUTTON, { state: 'hidden', timeout: 30000 });
    } catch {
      // Stop button never appeared; fall back to a fixed wait.
      await this.page.waitForTimeout(5000);
    }

    // Small settle delay so the final message is fully rendered.
    await this.page.waitForTimeout(2000);

    console.log('[Gemini] Extraindo resposta...');

    const response = await this.extractAssistantResponse();

    if (!response || response.length < 10) {
      console.warn('[Gemini] Resposta curta ou vazia, tentando debug...');
      await this.debugPageStructure();
      throw new Error('Resposta vazia ou inválida do Gemini');
    }

    console.log(`[Gemini] Resposta recebida (${response.length} caracteres)`);
    return response;
  }

  /**
   * Extracts only the assistant's response text, filtering out UI chrome.
   * Tries a list of targeted selectors first, then falls back to scanning for
   * the most substantial text block that does not look like interface chrome.
   */
  private async extractAssistantResponse(): Promise<string> {
    if (!this.page) return '';

    return this.page.evaluate((selectors) => {
      // Strip common UI text and keyboard-shortcut hints.
      const cleanText = (text: string): string => {
        if (!text) return '';
        const uiPatterns = [
          /Dictate.*/g,
          /Sign in.*/g,
          /Settings.*/g,
          /Switch model.*/g,
          /Submit.*/g,
          /Fullscreen.*/g,
          /New chat.*/g,
          /Send.*/g,
          /Stop.*/g,
          /Regenerate.*/g,
          /Copy.*/g,
          /Like.*/g,
          /Dislike.*/g,
          /Share.*/g,
          /Report.*/g,
          /Edit.*/g,
          /Delete.*/g,
          /\^⇧[A-Z]/g,
          /\^\w/g,
        ];
        let cleaned = text;
        for (const pattern of uiPatterns) {
          cleaned = cleaned.replace(pattern, '');
        }
        return cleaned.trim();
      };

      const isUiChrome = (text: string): boolean => {
        const uiKeywords = [
          'Dictate',
          'Sign in',
          'Settings',
          'Switch model',
          'Submit',
          'Fullscreen',
          'New chat',
          'Regenerate',
        ];
        return uiKeywords.some((k) => text.includes(k));
      };

      // 1) Targeted assistant-message selectors.
      for (const selector of selectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length === 0) continue;

        const lastEl = elements[elements.length - 1];
        const text = cleanText(lastEl.textContent || '');
        if (text.length > 10 && !isUiChrome(text)) {
          return text;
        }
      }

      // 2) Fallback: scan for the most substantial non-UI text block.
      const allElements = document.querySelectorAll('div, p, span, pre, code, article');
      const candidates = Array.from(allElements)
        .map((el) => cleanText(el.textContent || ''))
        .filter(
          (text) =>
            text.length > 20 &&
            !isUiChrome(text) &&
            !/^[\^⇧]{1,2}[A-Z]/.test(text)
        )
        .sort((a, b) => b.length - a.length);

      if (candidates.length > 0) {
        return candidates[0];
      }

      return '';
    }, ASSISTANT_SELECTORS);
  }

  /** Logs a sample of page text to help tune selectors when the UI changes. */
  private async debugPageStructure(): Promise<void> {
    try {
      console.log('[Gemini] Debugando estrutura da página...');
      const structure = await this.page?.evaluate(() => {
        const elements = document.querySelectorAll('div, p, span, pre, code, article');
        const result: Array<{ tag: string; class: string; id: string; text: string }> = [];
        for (const el of elements) {
          const text = el.textContent?.trim() || '';
          if (text.length > 20 && text.length < 500) {
            result.push({
              tag: el.tagName,
              class: typeof el.className === 'string' ? el.className : '',
              id: el.id,
              text: text.slice(0, 100),
            });
          }
        }
        return result.slice(0, 10);
      });
      console.log('📄 Estrutura da página:', JSON.stringify(structure, null, 2));
    } catch (error) {
      console.error('Erro ao debuggar estrutura:', error);
    }
  }
}