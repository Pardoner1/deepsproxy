/*
 * File: gemini.login.ts
 * Project: deepsproxy
 * Interactive login entry point for the Gemini web provider.
 *
 * Supports both automated login (when GEMINI_EMAIL/GEMINI_PASSWORD are set in
 * .env) and manual login. In manual mode the browser stays open until the
 * user presses ENTER after completing the sign-in.
 */

import { GeminiWebProvider } from '../services/gemini.web.ts';
import { getConfig } from '../utils/config.ts';
import readline from 'readline';

// Função para esperar o usuário pressionar Enter
function waitForEnter(): Promise<void> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question('\n📌 Pressione ENTER após completar o login no navegador... ', () => {
      rl.close();
      resolve();
    });
  });
}

async function askSaveAnyway(provider: GeminiWebProvider): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const answer = await new Promise<string>((resolve) => {
    rl.question('   Salvar sessão atual mesmo assim? (s/N): ', resolve);
  });
  rl.close();

  if (answer.toLowerCase() === 's') {
    await provider.saveSession();
    console.log(`📁 Perfil salvo em: ${provider.profileDir}`);
  } else {
    console.log('❌ Login cancelado.');
  }
}

export async function loginGemini(): Promise<void> {
  const { GEMINI_EMAIL, GEMINI_PASSWORD } = getConfig();

  console.log('🌐 Abrindo navegador para login no Gemini...');

  const provider = new GeminiWebProvider();
  await provider.initialize(false);
  await provider.enableManualLogin();

  // Login automático quando credenciais estão presentes no .env.
  if (GEMINI_EMAIL && GEMINI_PASSWORD) {
    try {
      await provider.login(GEMINI_EMAIL, GEMINI_PASSWORD);
      if (await provider.checkLoginStatus()) {
        console.log('✅ Login automático realizado! Salvando sessão...');
        await provider.saveSession();
        console.log(`📁 Perfil salvo em: ${provider.profileDir}`);
        await provider.close(true);
        return;
      }
    } catch (err) {
      console.warn('⚠️ Login automático falhou. Iniciando login manual...');
    }
  }

  // Verificar se já está logado.
  const isLoggedIn = await provider.checkLoginStatus();

  if (isLoggedIn) {
    console.log('✅ Já está logado! Salvando sessão...');
    await provider.saveSession();
    console.log(`📁 Perfil salvo em: ${provider.profileDir}`);
  } else {
    console.log('\n🔐 Por favor, faça login no Gemini no navegador que foi aberto.');
    console.log('   Siga os passos:');
    console.log('   1. Clique em "Sign in" ou "Fazer login"');
    console.log('   2. Digite seu email e senha');
    console.log('   3. Se houver 2FA, complete a verificação');
    console.log('   4. Aguarde a interface do Gemini carregar (com o campo de texto "Ask Gemini")');

    // AGUARDAR O USUÁRIO PRESSIONAR ENTER
    await waitForEnter();

    // Verificar novamente se o login foi feito
    const loginConfirmed = await provider.checkLoginStatus();

    if (loginConfirmed) {
      console.log('✅ Login detectado! Salvando sessão...');
      await provider.saveSession();
      console.log(`📁 Perfil salvo em: ${provider.profileDir}`);
    } else {
      console.warn('⚠️ Não foi possível detectar o login.');
      console.warn('   Verifique se você completou o login e a interface do Gemini carregou.');
      console.warn('   Se o problema persistir, execute com PLAYWRIGHT_HEADLESS=false');

      await askSaveAnyway(provider);
    }
  }

  await provider.close();
}