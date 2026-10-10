import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

let installation;

export async function launchBrowser() {
  try { return await chromium.launch(); }
  catch (error) {
    if (!error.message.includes("Executable doesn't exist at")) throw error;
  }
  if (!installation) {
    console.error('Downloading Chromium.');
    installation = new Promise((resolve, reject) => {
      const cli = fileURLToPath(new URL('cli.js', import.meta.resolve('playwright/package.json')));
      const child = spawn(process.execPath, [cli, 'install', 'chromium', '--only-shell'], { stdio: ['ignore', 2, 2] });
      child.on('error', reject);
      child.on('close', (code, signal) => code === 0 ? resolve() : reject(new Error(`Chromium setup failed (${signal || code}). See the download error above, then run lintapple again.`)));
    }).finally(() => { installation = undefined; });
  }
  await installation;
  return chromium.launch();
}
