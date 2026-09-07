/*
 * File: config.ts
 * Project: deepsproxy
 * Centralized configuration access based on environment variables.
 * Supports multiple web-scraping providers (gemini | deepseek) switched via PROVIDER.
 */

import * as dotenv from 'dotenv';

dotenv.config();

export type ProviderName = 'gemini' | 'deepseek';

export interface AppConfig {
  /** Active provider: 'gemini' (default) or 'deepseek' */
  PROVIDER: ProviderName;
  PORT: number;
  API_KEY?: string;
  PLAYWRIGHT_HEADLESS: boolean;
  PLAYWRIGHT_TIMEOUT: number;
  LOG_LEVEL: string;

  GEMINI_EMAIL?: string;
  GEMINI_PASSWORD?: string;
  DEEPSEEK_EMAIL?: string;
  DEEPSEEK_PASSWORD?: string;
}

function normalizeProvider(value: string | undefined): ProviderName {
  const v = (value || 'gemini').toLowerCase();
  if (v === 'deepseek') return 'deepseek';
  return 'gemini';
}

export function getConfig(): AppConfig {
  return {
    PROVIDER: normalizeProvider(process.env.PROVIDER),
    PORT: parseInt(process.env.PORT || '3000', 10),
    API_KEY: process.env.API_KEY,
    PLAYWRIGHT_HEADLESS: (process.env.PLAYWRIGHT_HEADLESS ?? 'true') !== 'false',
    PLAYWRIGHT_TIMEOUT: parseInt(process.env.PLAYWRIGHT_TIMEOUT || '30000', 10),
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',

    GEMINI_EMAIL: process.env.GEMINI_EMAIL,
    GEMINI_PASSWORD: process.env.GEMINI_PASSWORD,
    DEEPSEEK_EMAIL: process.env.DEEPSEEK_EMAIL,
    DEEPSEEK_PASSWORD: process.env.DEEPSEEK_PASSWORD,
  };
}
