import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
test('B039: overlapping release paths keep generated inputs', async()=>{
 const dir=await mkdtemp(join(tmpdir(),'lintapple-stage-'));
 try {await cp('dist',join(dir,'dist'),{recursive:true});await cp('package.json',join(dir,'package.json'));await symlink(resolve('node_modules'),join(dir,'node_modules'),'junction');
 const input=join(dir,'dist/demo/index.html'),before=await readFile(input);await symlink(join(dir,'dist'),join(dir,'build-alias'),'junction');
 for(const output of [dir,join(dir,'dist'),join(dir,'dist/new-stage'),join(dir,'build-alias/new-stage')]) {const p=spawnSync(process.execPath,[join(dir,'dist/scripts/build-release.js'),output],{cwd:dir,encoding:'utf8'});assert.notEqual(p.status,0);assert.match(p.stderr,/Use a separate directory/);assert.deepEqual(await readFile(input),before);}}
 finally {await rm(dir,{recursive:true,force:true});}
});
