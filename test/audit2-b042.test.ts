import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePolicy } from '../src/index.js';
test('B042: sparse policy values are rejected',()=>{
 for(const policy of [{fontSizes:Array<number>(1)},{fonts:Array<string>(1)},{bannedCopy:Array<string>(1)},{colorSchemes:Array<'light'>(1)},{typeRules:[{selector:'p',sizes:Array<number>(1)}]},{iconSizeRules:[{selector:'svg',sizes:Array<number>(1)}]}])assert.throws(()=>validatePolicy(policy));
 assert.doesNotThrow(()=>validatePolicy({fontSizes:[16],fonts:['system-ui'],colorSchemes:['light']}));
});
