/*
 * File: base.web.ts
 * Project: deepsproxy
 * Abstract base class for web-scraping providers (Gemini, DeepSeek).
 *
 * Providers share a single Playwright browser, a persistent profile directory
 * (so the session survives restarts) and a common lifecycle:
 *   initialize -> (login|loadSession) -> sendMessage -> close
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import fs from 'fs';
import path from 'path';
import { getConfig } from '../utils/config.ts';

export abstract class BaseWebProvider {
  protected browser: Browser | null = null;
  protected context: BrowserContext | null = null;
  protected page: Page | null = null;

  public readonly profileDir: string;
  protected providerName: string = 'WebProvider';

  constructor() {
    const { PROVIDER } = getConfig();
    this.profileDir = path.resolve(`./${PROVIDER}_profile/`);
  }

  /**
   * Launches the browser and opens a page bound to a persistent profile so
   * cookies/localStorage survive restarts (no re-login needed).
   */
  async initialize(headless?: boolean): Promise<void> {
    if (this.browser) return;

    const cfg = getConfig();
    const useHeadless = headless ?? cfg.PLAYWRIGHT_HEADLESS;

    fs.mkdirSync(this.profileDir, { recursive: true });

    this.context = await chromium.launchPersistentContext(this.profileDir, {
      headless: useHeadless,
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
      args: [
        '--disable-blink-features=AutomationControlled',
        '--exclude-switches=enable-automation',
        '--disable-infobars',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    this.page = await this.context.newPage();
  }

  /** Persists the current session to a JSON state file. */
  async saveSession(): Promise<void> {
    if (!this.page) return;
    fs.mkdirSync(this.profileDir, { recursive: true });
    await this.page.context().storageState({ path: path.join(this.profileDir, 'state.json') });
  }

  /**
   * Restores a previously saved session (cookies/storage). The persistent
   * profile directory already keeps the session alive across runs, so this is
   * primarily useful when the browser was launched without a profile dir.
   */
  async loadSession(): Promise<void> {
    if (!this.page) return;
    const statePath = path.join(this.profileDir, 'state.json');
    if (!fs.existsSync(statePath)) return;
    try {
      await this.page.context().addCookies(JSON.parse(fs.readFileSync(statePath, 'utf8')).cookies || []);
    } catch (err) {
      console.warn(`[${this.providerName}] Failed to load saved session:`, err);
    }
  }

  /** True when a saved session exists on disk. */
  hasSavedSession(): boolean {
    return fs.existsSync(path.join(this.profileDir, 'state.json'));
  }

  /** Performs an interactive or credential-based login. */
  abstract login(email?: string, password?: string): Promise<void>;

  /** Sends a prompt and returns the provider's full text response. */
  abstract sendMessage(prompt: string): Promise<string>;

  /** Whether the provider is currently authenticated and ready. */
  abstract isLoggedIn(): Promise<boolean>;

  /** List of model identifiers exposed by this provider. */
  abstract getAvailableModels(): string[];

  async close(): Promise<void> {
    if (this.context) {
      await this.context.close();
      this.context = null;
      this.browser = null;
      this.page = null;
    } else {
      await this.browser?.close();
      this.browser = null;
      this.page = null;
    }
  }
}
