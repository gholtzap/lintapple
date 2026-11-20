import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, stat, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
test('B038: init keeps private package permissions', async()=>{
 const dir=await mkdtemp(join(tmpdir(),'lintapple-mode-'));const mask=process.umask(0o022);
 try {for(const mode of [0o600,0o640]){await writeFile(join(dir,'package.json'),'{"name":"fixture"}');await chmod(join(dir,'package.json'),mode);execFileSync(process.execPath,[resolve('dist/bin/lintapple.js'),'init'],{cwd:dir});assert.equal((await stat(join(dir,'package.json'))).mode&0o777,mode);}}
 finally {process.umask(mask);await rm(dir,{recursive:true,force:true});}
});
