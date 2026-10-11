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
      const child = spawn(process.execPath, [cli, 'install', 'chromium', '--only-shell'], { stdio: ['ignore', 2, 'pipe'] });
      let stderr = '', noSpace = false;
      child.stderr.on('data', chunk => {
        stderr = (stderr + chunk).slice(-8192);
        noSpace ||= stderr.includes('ENOSPC');
      });
      child.on('error', reject);
      child.on('close', (code, signal) => {
        if (!noSpace && stderr) process.stderr.write(stderr);
        if (code === 0) return resolve();
        const error = new Error(`Chromium setup failed (${signal || code}). See the download error above, then run lintapple again.`);
        if (noSpace) error.code = 'ENOSPC';
        reject(error);
      });
    }).finally(() => { installation = undefined; });
  }
  await installation;
  return chromium.launch();
}
