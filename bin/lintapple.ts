#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { validateInteractions } from '../src/interactions.js';
import { checkUrl, validatePolicy } from '../src/index.js';
import { initProject, loadProjectPolicy, parseJson } from '../src/project.js';
import { formatSummary, formatFrameCoverage, formatControlContentCoverage, formatTooltipCoverage } from '../src/report.js';
import { formatCliError } from '../src/cli-error.js';

const usage = `Usage: lintapple <url> [--config path] [--ready selector] [--interactions path] [--json]
       lintapple init
Loads ui-policy.json from the working directory unless --config is set.
Domains use HTTPS by default. Localhost and loopback addresses use HTTP.
Check the page at each configured viewport. Exit 0: pass, 1: UI findings, 2: execution error.`;
const args = process.argv.slice(2);
let url: string | undefined;
try {
  if (args.includes('--help')) { console.log(usage); process.exit(0); }
  if (args[0] === 'init') {
    if (args.length !== 1) throw new Error('Use lintapple init without additional arguments.');
    await initProject();
    process.exit(0);
  }
  let config: string | undefined, ready: string | undefined, interactionsPath: string | undefined, json = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') json = true;
    else if (arg === '--config' || arg === '--ready' || arg === '--interactions') {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}.`);
      if (arg === '--config') config = value;
      else if (arg === '--interactions') interactionsPath = value;
      else ready = value;
    } else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}. Use lintapple <url>. Run lintapple --help for options.`);
    else if (url) throw new Error('Provide one URL.');
    else url = arg;
  }
  if (!url) throw new Error(usage);
  // A host followed by a numeric port is not a URL scheme.
  if (!/^[a-z][a-z\d+.-]*:(?!\d+(?:[/?#]|$))/i.test(url)) {
    const parsed = new URL(`https://${url}`);
    const hostname = parsed.hostname.replace(/\.$/, '');
    const local = hostname === 'localhost' || hostname === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(hostname);
    if (local) parsed.protocol = 'http:';
    if (local || parsed.hostname.includes('.')) url = parsed.href;
  }
  const policy = await loadProjectPolicy(config);
  const interactions = interactionsPath ? validateInteractions(parseJson(await readFile(interactionsPath, 'utf8'), interactionsPath)) : undefined;
  const approved = validatePolicy(policy);
  console.error(`Policy: ${Object.keys(policy).length ? config ?? 'ui-policy.json' : 'package defaults'}. Approved fonts: ${approved.fonts.join(', ')}. Text sizes: ${approved.fontSizes.join(', ')}px. Font-family and font-size findings compare the page with this policy.`);
  const report = await checkUrl(url, policy, { ready, interactions });
  if (json) console.log(JSON.stringify(report, null, 2));
  else {
    const count = report.runs.reduce((sum, run) => sum + run.states.length, 0);
    console.log(`${report.findings.length ? 'Failed' : 'Passed'} across ${count} page checks. ${formatSummary(report.summary)}`);
    console.log(formatFrameCoverage(report.runs.flatMap(run => run.states.map(state => state.frameCoverage))));
    console.log(formatControlContentCoverage(report.runs.flatMap(run => run.states.map(state => state.controlContentCoverage))));
    console.log(formatTooltipCoverage(report.runs.map(run => run.accessibilityCoverage.tooltips)));
    const suppressed = report.runs.reduce((sum, run) => sum + run.suppressed.length, 0);
    if (suppressed) console.log(`\n${suppressed} findings excluded by policy. See the JSON report for reasons.`);
  }
  process.exitCode = report.findings.length ? 1 : 0;
} catch (error) {
  const message = formatCliError(error, { url, initializing: args[0] === 'init' });
  console.error(`UI check could not finish: ${message}`);
  process.exitCode = 2;
}
