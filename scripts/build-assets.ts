import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = join(root, 'dist');
for (const directory of ['demo', 'examples']) {
  await mkdir(join(output, directory), { recursive: true });
  await cp(join(root, directory), join(output, directory), {
    recursive: true,
    filter: path => !path.endsWith('.ts') && !path.endsWith('.mts'),
  });
}
await cp(join(root, 'ui-policy.json'), join(output, 'ui-policy.json'));
