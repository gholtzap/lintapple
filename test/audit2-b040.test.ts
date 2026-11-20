import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
test('B040: prepack removes obsolete generated modules', async()=>{
 const dir=await mkdtemp(join(tmpdir(),'lintapple-pack-'));
 try {for(const name of ['src','scripts','demo','examples'])await cp(name,join(dir,name),{recursive:true});for(const name of ['package.json','tsconfig.json','ui-policy.json','README.md'])await cp(name,join(dir,name));await symlink(resolve('node_modules'),join(dir,'node_modules'),'junction');
 await mkdir(join(dir,'dist/src'),{recursive:true});await writeFile(join(dir,'dist/src/removed.js'),'export const removed="not for release";');
 const packed: {files:{path:string}[]}[]=JSON.parse(execFileSync('npm',['pack','--silent','--json'],{cwd:dir,encoding:'utf8'}));assert.ok(!packed[0].files.some(f=>f.path==='dist/src/removed.js'));assert.ok(packed[0].files.some(f=>f.path==='dist/src/index.js'));}
 finally {await rm(dir,{recursive:true,force:true});}
});
