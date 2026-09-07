/*
 * File: gemini.login.ts
 * Project: deepsproxy
 * Interactive login entry point for the Gemini web provider.
 */

import { GeminiWebProvider } from '../services/gemini.web.ts';
import { getConfig } from '../utils/config.ts';

export async function loginGemini(): Promise<void> {
  const { GEMINI_EMAIL, GEMINI_PASSWORD } = getConfig();

  if (!GEMINI_EMAIL || !GEMINI_PASSWORD) {
    console.error('❌ GEMINI_EMAIL and GEMINI_PASSWORD are required for automated login.');
    console.error('   Add to your .env:');
    console.error('   GEMINI_EMAIL=your-email@gmail.com');
    console.error('   GEMINI_PASSWORD=your-password');
    console.error('   (The browser will open; you can also complete the login manually,');
    console.error('    then close the browser — the session is persisted.)');
  }

  console.log('🌐 Opening browser for Gemini login...');
  const provider = new GeminiWebProvider();
  await provider.initialize(false);
  await provider.login(GEMINI_EMAIL, GEMINI_PASSWORD);

  console.log(`✅ Login complete. Profile saved in: ${provider.profileDir}`);
  await provider.close();
}
