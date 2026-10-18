import { cp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = await realpath(fileURLToPath(new URL('../../', import.meta.url)));
const output = join(root, 'dist');
const stage = resolve(process.argv[2] || join(root, 'test-results/production-stage'));
const existingStage = await realpath(stage).catch((error: NodeJS.ErrnoException) => {
  if (error.code !== 'ENOENT') throw error;
  return undefined;
});
if (existingStage === root) throw new Error('Use a separate directory for the release.');
const pkg: { version: string } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
execFileSync(process.execPath, [join(output, 'scripts/highlight-demo.js')], { cwd: root });
await mkdir(join(stage, 'downloads'), { recursive: true });
await rm(join(stage, 'demo'), { recursive: true, force: true });
await cp(join(output, 'demo'), join(stage, 'demo'), { recursive: true });
await mkdir(join(stage, 'demo/vendor'), { recursive: true });
for (const name of ['lenis.mjs', 'lenis.css']) await cp(join(root, 'node_modules/lenis/dist', name), join(stage, 'demo/vendor', name));
await cp(join(root, 'node_modules/lenis/LICENSE'), join(stage, 'demo/vendor/lenis.LICENSE'));
await mkdir(join(stage, 'examples'), { recursive: true });
await cp(join(root, 'examples/ui.css'), join(stage, 'examples/ui.css'));
await cp(join(root, 'README.md'), join(stage, 'README.md'));
const packages: { filename: string; integrity: string }[] = JSON.parse(execFileSync('npm', ['pack', '--silent', '--json', '--pack-destination', join(stage, 'downloads')], { cwd: root, encoding: 'utf8' }));
const packed = packages[0];
const hashes: Record<string, string> = {};
const scan = async (directory: string): Promise<void> => {
  for (const entry of await readdir(join(stage, directory), { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await scan(path);
    else hashes[path] = createHash('sha256').update(await readFile(join(stage, path))).digest('hex');
  }
};
for (const directory of ['demo', 'examples', 'downloads']) await scan(directory);
const release = { version: pkg.version, sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), package: `downloads/${packed.filename}`, packageIntegrity: packed.integrity, hashes };
await writeFile(join(stage, 'release.json'), JSON.stringify(release, null, 2));
await writeFile(join(stage, 'vercel.json'), JSON.stringify({
  redirects: [
    { source: '/', has: [{ type: 'host', value: 'lintapple-demo.vercel.app' }], destination: 'https://lintapple.vercel.app/', permanent: true },
    { source: '/demo', destination: 'https://lintapple.vercel.app/', permanent: true },
    { source: '/demo/', destination: 'https://lintapple.vercel.app/', permanent: true },
    { source: '/demo/:path*', destination: 'https://lintapple.vercel.app/:path*', permanent: true },
    { source: '/:path*', has: [{ type: 'host', value: 'lintapple-demo.vercel.app' }], destination: 'https://lintapple.vercel.app/:path*', permanent: true },
  ],
  rewrites: [
    { source: '/', destination: '/demo/index.html' },
    ...Object.keys(hashes).filter(path => path.startsWith('demo/')).map(path => ({ source: `/${path.slice(5)}`, destination: `/${path}` })),
  ],
  headers: [{ source: '/(.*)', headers: [{ key: 'Cache-Control', value: 'no-store' }] }],
}, null, 2));
console.log(JSON.stringify({ stage, version: pkg.version, sourceCommit: release.sourceCommit, package: release.package, files: Object.keys(hashes).length }));
