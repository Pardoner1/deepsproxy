/*
 * File: login.ts
 * Project: deepsproxy
 * Entry point for provider login. Dispatches to the provider selected by the
 * PROVIDER env var (default: gemini).
 *
 * Usage:
 *   npm run login              # uses PROVIDER from .env
 *   npm run login:gemini
 *   npm run login:deepseek
 */

import { loginDeepSeek } from './login/deepseek.login.ts';
import { loginGemini } from './login/gemini.login.ts';
import { getConfig } from './utils/config.ts';

async function main() {
  const { PROVIDER } = getConfig();

  console.log(`🔐 Login for provider: ${PROVIDER.toUpperCase()}`);

  try {
    switch (PROVIDER) {
      case 'gemini':
        await loginGemini();
        break;
      case 'deepseek':
        await loginDeepSeek();
        break;
      default:
        console.error(`❌ Provider inválido: ${PROVIDER}`);
        console.log('   Opções válidas: gemini, deepseek');
        process.exit(1);
    }
  } catch (error) {
    console.error('❌ Erro durante o login:', error);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
