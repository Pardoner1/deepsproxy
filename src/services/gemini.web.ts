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

  private async waitForGeminiResponse(timeout: number = 60000): Promise<string> {
    if (!this.page) throw new Error('Browser not initialized');

    console.log('[Gemini] Aguardando resposta...');

    try {
      // 1. Aguardar o botão "Stop" desaparecer (indica que terminou de gerar)
      try {
        await this.page.waitForSelector(
          'button[aria-label*="Stop"], button[data-testid="stop-button"]',
          { state: 'hidden', timeout: 30000 }
        );
        console.log('[Gemini] Botão Stop desapareceu');
      } catch {
        console.log('[Gemini] Botão Stop não encontrado, continuando...');
      }

// 2. Aguardar o texto completo ser renderizado
      // Esperar até que o último parágrafo tenha texto substancial
      await this.page.waitForFunction(
        () => {
          const container = document.querySelector(
            'message-content[id^="message-content-id-"] .markdown.markdown-main-panel'
          );
          if (!container) return false;

          const paragraphs = container.querySelectorAll('p');
          if (paragraphs.length === 0) return false;

          // Verificar se o último parágrafo tem mais de 10 caracteres
          const lastP = paragraphs[paragraphs.length - 1];
          const text = lastP?.textContent?.trim() || '';
          return text.length > 10;
        },
        { timeout: 10000 }
      );
      console.log('[Gemini] Texto completo renderizado');

      // 3. Aguardar mais um pouco para garantir
      await this.page.waitForTimeout(1000);

      // 4. Encontrar o container da resposta
      const container = await this.page.waitForSelector(
        'message-content[id^="message-content-id-"] .markdown.markdown-main-panel',
        { timeout: 5000 }
      ).catch(() => null);

      if (!container) {
        const altContainer = await this.page.waitForSelector(
          'message-content .markdown',
          { timeout: 5000 }
        ).catch(() => null);
        if (!altContainer) {
          throw new Error('Container de resposta não encontrado');
        }

        return await this.extractParagraphs(altContainer);
      }

      // 5. Extrair TODOS os parágrafos
      return await this.extractParagraphs(container);

    } catch (error) {
      console.error('[Gemini] Erro ao aguardar resposta:', error);

      // Debug: salvar estrutura da página
      await this.debugPageStructure();
      throw error;
    }
  }

  private async extractParagraphs(container: any): Promise<string> {
    const paragraphs = await container.$$('p');

    if (paragraphs.length === 0) {
      throw new Error('Nenhum parágrafo encontrado');
    }

    const texts: string[] = [];
    for (const p of paragraphs) {
      const text = await p.textContent();
      if (text && text.trim().length > 0) {
        texts.push(text.trim());
      }
    }

    const fullResponse = texts.join('\n\n');

    if (!fullResponse || fullResponse.length < 10) {
      throw new Error('Resposta vazia ou muito curta');
    }

    console.log(`[Gemini] Resposta recebida (${fullResponse.length} caracteres, ${texts.length} parágrafos)`);
    console.log(`[Gemini] Preview: ${fullResponse.slice(0, 100)}...`);

    return this.cleanResponseText(fullResponse);
  }

  private cleanResponseText(text: string): string {
    return text
      .replace(/Dictate.*/g, '')
      .replace(/Sign in.*/g, '')
      .replace(/Settings.*/g, '')
      .replace(/Switch model.*/g, '')
      .replace(/Submit.*/g, '')
      .replace(/Fullscreen.*/g, '')
      .replace(/User:.*/g, '')
      .replace(/ConversaSparkBeta/g, '')
      .replace(/Novo notebook/g, '')
      .replace(/Untitled notebook/g, '')
      .replace(/Recentes/g, '')
      .trim();
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