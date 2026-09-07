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

export class GeminiWebProvider extends BaseWebProvider {
  private readonly GEMINI_URL = GEMINI_URL;
  private manualLoginMode = false;

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

      console.log('[Gemini] Verificando login...');

      // Ir para a página do Gemini
      await this.page.goto(this.GEMINI_URL, { waitUntil: 'domcontentloaded' });
      await this.page.waitForTimeout(3000);

      // MÉTODO 1: Verificar se há uma conversa ou histórico (MAIS CONFIÁVEL)
      const hasConversation = await this.page.evaluate(`
        (function() {
          var conversationSelectors = [
            '[data-message-type]',
            '.conversation-item',
            '.message-content',
            '[role="article"]'
          ];
          for (var i = 0; i < conversationSelectors.length; i++) {
            if (document.querySelectorAll(conversationSelectors[i]).length > 0) {
              return true;
            }
          }
          return false;
        })();
      `);

      if (hasConversation) {
        console.log('[Gemini] Login detectado por conversa existente');
        return true;
      }

      // MÉTODO 2: Verificar se há campo de input E NÃO há botão de login
      const hasInput = await this.page.evaluate(`
        (function() {
          var inputs = document.querySelectorAll('textarea, input[type="text"], [contenteditable="true"]');
          for (var i = 0; i < inputs.length; i++) {
            var placeholder = inputs[i].getAttribute('placeholder') || '';
            var p = placeholder.toLowerCase();
            if (p.indexOf('ask') !== -1 || p.indexOf('pergunte') !== -1 || p.indexOf('perguntar') !== -1) {
              return true;
            }
          }
          return false;
        })();
      `);

      if (hasInput) {
        // Verificar se NÃO há botão "Sign in"
        const hasSignIn = await this.page.evaluate(`
          (function() {
            var buttons = document.querySelectorAll('button, a');
            for (var i = 0; i < buttons.length; i++) {
              var text = (buttons[i].textContent || '').toLowerCase();
              if (text.indexOf('sign in') !== -1 ||
                  text.indexOf('fazer login') !== -1 ||
                  text.indexOf('entrar') !== -1) {
                return true;
              }
            }
            return false;
          })();
        `);

        if (!hasSignIn) {
          console.log('[Gemini] Login detectado por input sem botão de login');
          return true;
        }
      }

      // MÉTODO 3: Verificar se há avatar do usuário
      const hasAvatar = await this.page.evaluate(`
        (function() {
          var elements = document.querySelectorAll('[class*="avatar"], [class*="profile"], [class*="user"]');
          for (var i = 0; i < elements.length; i++) {
            var text = elements[i].textContent || '';
            if (text.length > 0 && text.length < 50 && text.indexOf('Sign in') === -1) {
              return true;
            }
          }
          return false;
        })();
      `);

      if (hasAvatar) {
        console.log('[Gemini] Login detectado por avatar');
        return true;
      }

      console.log('[Gemini] Nenhum método detectou login');
      return false;

    } catch (error) {
      console.log('[Gemini] Erro ao verificar login:', error);
      return false;
    }
  }

  getAvailableModels(): string[] {
    return ['gemini-pro', 'gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.0-flash'];
  }

  /**
   * Habilita o modo de login manual - mantém o navegador aberto e permite
   * que o usuário faça login manualmente sem que o navegador seja fechado.
   */
  async enableManualLogin(): Promise<void> {
    this.manualLoginMode = true;
    console.log('[Gemini] Modo de login manual ativado. O navegador permanecerá aberto.');
  }

  /**
   * Verifica o status do login sem tentar fazer login automaticamente.
   * Retorna true quando o usuário está autenticado (campo de texto presente
   * e nenhum botão de "Sign in" visível).
   */
  async checkLoginStatus(): Promise<boolean> {
    if (!this.page) return false;

    try {
      await this.page.goto(this.GEMINI_URL, { waitUntil: 'domcontentloaded', timeout: 10000 });
      await this.page.waitForTimeout(3000);

      const hasTextarea = await this.page.$(
        'textarea[placeholder*="Ask Gemini"], textarea[placeholder*="Pergunte"]'
      );
      const hasLoginButton = await this.page.$(
        'button:has-text("Sign in"), button:has-text("Fazer login")'
      );

      return !!hasTextarea && !hasLoginButton;
    } catch (error) {
      console.log('[Gemini] Erro ao verificar login:', error);
      return false;
    }
  }

  /**
   * Sobrescreve o método close para não fechar o navegador em modo de login
   * manual. Use close(true) para forçar o fechamento.
   */
  async close(force: boolean = false): Promise<void> {
    if (force || !this.manualLoginMode) {
      await super.close();
    } else {
      console.log('[Gemini] Navegador mantido aberto para login manual.');
      console.log('[Gemini] Feche o navegador manualmente quando terminar.');
    }
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
   *
   * IMPORTANT: the extraction code is passed to page.evaluate() as a STRING of
   * plain browser JavaScript. Passing a compiled function lets tsx/esbuild
   * inject the `__name` helper, which does not exist in the browser context and
   * throws "ReferenceError: __name is not defined". A string is executed
   * verbatim and avoids that transform entirely.
   */
  private async extractAssistantResponse(): Promise<string> {
    if (!this.page) return '';

    console.log('[Gemini] Extraindo resposta...');

    // Código JavaScript PURO para executar no navegador.
    // NADA de TypeScript, NADA de funções nomeadas decoradas por tsx.
    const extractScript = `
      (function() {
        // Função de limpeza
        function cleanText(text) {
          if (!text) return '';
          // Remover textos da UI
          var uiPatterns = [
            'Dictate', 'Sign in', 'Settings', 'Switch model',
            'Submit', 'Fullscreen', 'New chat', 'Send', 'Stop',
            'Regenerate', 'Copy', 'Like', 'Dislike', 'Share',
            'Report', 'Edit', 'Delete', 'Conversa', 'Spark',
            'Beta', 'Pesquisar conversas', 'Imagens', 'Vídeos',
            'Biblioteca', 'Notebooks', 'Recentes', 'Pro',
            'Nova conversa', 'Novo notebook', 'Untitled notebook'
          ];
          var cleaned = text;
          for (var i = 0; i < uiPatterns.length; i++) {
            cleaned = cleaned.replace(new RegExp(uiPatterns[i], 'gi'), '');
          }
          return cleaned.replace(/\\s+/g, ' ').trim();
        }

        // Verificar se o texto é da UI
        function isUiText(text) {
          var uiKeywords = [
            'Dictate', 'Sign in', 'Settings', 'Switch model',
            'Submit', 'Fullscreen', 'New chat', 'Conversa',
            'Spark', 'Beta', 'Pesquisar conversas', 'Imagens',
            'Vídeos', 'Biblioteca', 'Notebooks', 'Recentes',
            'Pro', 'Nova conversa', 'Novo notebook'
          ];
          for (var i = 0; i < uiKeywords.length; i++) {
            if (text.indexOf(uiKeywords[i]) !== -1) return true;
          }
          return false;
        }

        // MÉTODO 1: Procurar mensagens do assistente com data-message-type
        var assistantMessages = document.querySelectorAll('[data-message-type="assistant"]');
        if (assistantMessages.length > 0) {
          // Pegar a ÚLTIMA mensagem do assistente
          var lastMessage = assistantMessages[assistantMessages.length - 1];
          var text = cleanText(lastMessage.textContent || '');
          if (text.length > 10 && !isUiText(text)) {
            return text;
          }
        }

        // MÉTODO 2: Procurar por mensagens com classe específica
        var messageSelectors = [
          '.message-content.assistant',
          '.model-response-text',
          '[data-testid="assistant-message"]',
          '.conversation-item:last-child [data-message-type="assistant"]'
        ];

        for (var s = 0; s < messageSelectors.length; s++) {
          var elements = document.querySelectorAll(messageSelectors[s]);
          if (elements.length > 0) {
            var lastEl = elements[elements.length - 1];
            var text = cleanText(lastEl.textContent || '');
            if (text.length > 10 && !isUiText(text)) {
              return text;
            }
          }
        }

        // MÉTODO 3: Procurar por qualquer elemento com texto substancial
        // que NÃO seja da UI
        var allElements = document.querySelectorAll('div, p, span, pre, code');
        var candidates = [];

        for (var i = 0; i < allElements.length; i++) {
          var el = allElements[i];
          var text = cleanText(el.textContent || '');
          // Verificar se o elemento é uma mensagem (não UI)
          if (text.length > 20 && !isUiText(text)) {
            // Verificar se o elemento não é um botón, menu o header
            var className = typeof el.className === 'string' ? el.className : '';
            var role = el.getAttribute('role') || '';
            if (className.indexOf('button') === -1 &&
                className.indexOf('menu') === -1 &&
                className.indexOf('header') === -1 &&
                className.indexOf('toolbar') === -1 &&
                role !== 'button' &&
                role !== 'menu') {
              candidates.push({
                text: text,
                length: text.length,
                depth: el.parentElement ? el.parentElement.children.length : 0
              });
            }
          }
        }

        // Pegar o candidato com maior texto (que não é UI)
        if (candidates.length > 0) {
          candidates.sort(function(a, b) { return b.length - a.length; });
          // Verificar se o maior não é UI
          if (!isUiText(candidates[0].text)) {
            return candidates[0].text;
          }
          // Tentar o segundo
          if (candidates.length > 1 && !isUiText(candidates[1].text)) {
            return candidates[1].text;
          }
        }

        return '';
      })();
    `;

    try {
      const response = await this.page.evaluate(extractScript) as string;

      if (!response || response.length < 10) {
        console.warn('[Gemini] Resposta curta ou vazia');
        await this.debugPageStructure();
        return '';
      }

      console.log(`[Gemini] Resposta recebida (${response.length} caracteres)`);
      console.log(`[Gemini] Preview: ${response.slice(0, 200)}...`);
      return response;
    } catch (error) {
      console.error('[Gemini] Erro ao extrair resposta:', error);
      await this.debugPageStructure();
      throw error;
    }
  }

  /** Logs a sample of page text to help tune selectors when the UI changes. */
  private async debugPageStructure(): Promise<void> {
    try {
      console.log('[Gemini] Debugando estrutura da página...');
      // String literal de JS puro, como em extractAssistantResponse, para
      // evitar a injeção do helper `__name` pelo tsx/esbuild.
      const debugScript = `
        (function() {
          var elements = document.querySelectorAll('div, p, span, pre, code, article');
          var result = [];
          for (var i = 0; i < elements.length; i++) {
            var el = elements[i];
            var text = (el.textContent || '').trim();
            if (text.length > 20 && text.length < 500) {
              result.push({
                tag: el.tagName,
                className: typeof el.className === 'string' ? el.className : '',
                id: el.id,
                text: text.slice(0, 100)
              });
            }
          }
          return result.slice(0, 10);
        })();
      `;
      const structure = await this.page?.evaluate(debugScript);
      console.log('📄 Estrutura da página:', JSON.stringify(structure, null, 2));
    } catch (error) {
      console.error('Erro ao debuggar estrutura:', error);
    }
  }
}