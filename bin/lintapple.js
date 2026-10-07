#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { checkUrl } from '../src/index.js';

const usage = `Usage: lintapple <url> [--config path] [--ready selector] [--json]
Check the page at each configured viewport. Exit 0: pass, 1: design errors, 2: execution error.`;
try {
  const args = process.argv.slice(2);
  if (args.includes('--help')) { console.log(usage); process.exit(0); }
  let url, config, ready, json = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') json = true;
    else if (arg === '--config' || arg === '--ready') {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}.`);
      if (arg === '--config') config = value; else ready = value;
    } else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else if (url) throw new Error('Provide one URL.');
    else url = arg;
  }
  if (!url) throw new Error(usage);
  const policy = config ? JSON.parse(await readFile(config, 'utf8')) : {};
  const report = await checkUrl(url, policy, { ready });
  if (json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`${report.findings.length ? 'Failed' : 'Passed'}: ${report.findings.length} design errors across ${report.runs.length} page checks.`);
    for (const f of report.findings) console.log(`\n${f.rule} (${f.viewport.width}px, ${f.colorScheme})\n${f.selector}\n${f.message}\nFix: ${f.fix}`);
    const suppressed = report.runs.reduce((sum, run) => sum + run.suppressed.length, 0);
    if (suppressed) console.log(`\n${suppressed} findings excluded by policy. See the JSON report for reasons.`);
  }
  process.exitCode = report.findings.length ? 1 : 0;
} catch (error) { console.error(`UI check could not finish: ${error.message}`); process.exitCode = 2; }
