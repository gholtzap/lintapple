import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));
interface Release { version: string; sourceCommit: string; package: string; packageIntegrity: string; hashes: Record<string, string> }

test('a checkout with spaces builds a complete release with verified package and asset hashes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lintapple release '));
  const checkout = join(directory, 'source checkout');
  const stage = join(directory, 'release stage');
  await mkdir(checkout);
  try {
    for (const name of ['src', 'bin', 'demo', 'scripts', 'examples', 'package.json', 'package-lock.json', 'tsconfig.json', 'ui-policy.json', 'README.md', 'LICENSE'])
      await cp(join(root, name), join(checkout, name), { recursive: true });
    await symlink(join(root, 'node_modules'), join(checkout, 'node_modules'), 'junction');
    const sourceCommit = (await execute('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
    const gitDirectory = (await execute('git', ['rev-parse', '--absolute-git-dir'], { cwd: root })).stdout.trim();
    const env = { ...process.env, GIT_DIR: gitDirectory, GIT_WORK_TREE: checkout };
    await execute('npm', ['run', 'release:build', '--', stage], { cwd: checkout, env });
    const release: Release = JSON.parse(await readFile(join(stage, 'release.json'), 'utf8'));
    assert.equal(release.sourceCommit, sourceCommit);
    for (const [path, expected] of Object.entries(release.hashes))
      assert.equal(createHash('sha256').update(await readFile(join(stage, path))).digest('hex'), expected, path);
    const routes: { rewrites: { source: string; destination: string }[]; redirects: { source: string; destination: string }[] } = JSON.parse(await readFile(join(stage, 'vercel.json'), 'utf8'));
    assert.ok(routes.rewrites.some(route => route.source === '/rule/:id' && route.destination === '/demo/index.html'));
    assert.ok(routes.redirects.some(route => route.source === '/demo/:path*' && route.destination === '/:path*'));
    assert.match(await readFile(join(stage, 'demo/index.html'), 'utf8'), /<base href="\/">/);
    assert.match(await readFile(join(checkout, 'demo/index.html'), 'utf8'), /<base href="\/demo\/">/);
    const packed = await readFile(join(stage, release.package));
    assert.equal(`sha512-${createHash('sha512').update(packed).digest('base64')}`, release.packageIntegrity);
    for (const path of ['demo/index.html', 'demo/app.js', 'demo/specimen.js', 'demo/vendor/lenis.mjs', 'examples/ui.css', release.package])
      assert.ok(release.hashes[path], `The release must include ${path}.`);
    await assert.rejects(readFile(join(stage, 'demo/app.ts')), { code: 'ENOENT' });
    execFileSync(process.execPath, ['--input-type=module', '--check'], { input: await readFile(join(stage, 'demo/app.js')) });
    await assert.rejects(execute(process.execPath, [join(checkout, 'dist/scripts/build-release.js'), checkout], { cwd: checkout, env }), /Use a separate directory/);
    const alias = join(directory, 'source alias');
    await symlink(checkout, alias, 'junction');
    await assert.rejects(execute(process.execPath, [join(checkout, 'dist/scripts/build-release.js'), alias], { cwd: checkout, env }), /Use a separate directory/);
    assert.equal(await readFile(join(checkout, 'demo/app.ts'), 'utf8'), await readFile(join(root, 'demo/app.ts'), 'utf8'));
    await mkdir(join(root, 'test-results'), { recursive: true });
    await writeFile(join(root, 'test-results/release-build.json'), JSON.stringify({ sourceCommit, files: Object.keys(release.hashes).length, packageIntegrity: release.packageIntegrity, pathWithSpaces: true }, null, 2));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
