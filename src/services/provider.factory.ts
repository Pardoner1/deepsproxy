/*
 * File: provider.factory.ts
 * Project: deepsproxy
 * Returns the active web-scraping provider based on the PROVIDER env var.
 * Defaults to 'gemini'.
 */

import { BaseWebProvider } from './base.web.ts';
import { GeminiWebProvider } from './gemini.web.ts';
import { DeepSeekWebProvider } from './deepseek.web.ts';
import { getConfig } from '../utils/config.ts';

export function getProvider(): BaseWebProvider {
  const { PROVIDER } = getConfig();

  console.log(`🚀 Provider: ${PROVIDER.toUpperCase()} (Web Scraping)`);

  switch (PROVIDER) {
    case 'deepseek':
      return new DeepSeekWebProvider();
    case 'gemini':
    default:
      return new GeminiWebProvider();
  }
}
