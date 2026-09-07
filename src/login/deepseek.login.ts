/*
 * File: deepseek.login.ts
 * Project: deepsproxy
 * Interactive login entry point for the DeepSeek web provider.
 */

import { DeepSeekWebProvider } from '../services/deepseek.web.ts';

export async function loginDeepSeek(): Promise<void> {
  console.log('🌐 Opening browser for DeepSeek login...');
  const provider = new DeepSeekWebProvider();
  await provider.initialize(false);
  await provider.login();
  console.log(`✅ Login complete. Profile saved in: ${provider.profileDir}`);
  await provider.close();
}
