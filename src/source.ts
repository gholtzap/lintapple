import type { ESLint as ESLintType, Linter } from 'eslint';
import { terminalText } from './report.js';
import { createRequire } from 'node:module';
import { resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface SourceReport {
  kind: 'source';
  status: 'passed' | 'failed' | 'incomplete';
  engine: { name: 'eslint'; version: string };
  files: { path: string; rules: string[] }[];
  skipped: { path: string; reason: string }[];
  findings: (Linter.LintMessage & { filePath: string })[];
  errors: string[];
}

const isDesignRule = (ruleId: string) => ruleId.startsWith('shadcn/');

export async function sourceCommand(args: string[]): Promise<number> {
  let config: string | undefined, json = false;
  const patterns: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') json = true;
    else if (arg === '--config') {
      config = args[++i];
      if (!config || config.startsWith('-')) throw new Error('Missing value for --config.');
    } else if (arg.startsWith('-')) throw new Error(`Unknown source option: ${arg}. Run lintapple source --help for options.`);
    else patterns.push(arg);
  }
  const cwd = process.cwd();
  const require = createRequire(resolve(cwd, 'package.json'));
  let entry: string;
  try { entry = require.resolve('eslint'); }
  catch (error) {
    throw new Error('Install ESLint in this project, then configure @shadcn/lint under the shadcn plugin name. See examples/source in the Lintapple package.', { cause: error });
  }
  const { ESLint } = await import(pathToFileURL(entry).href) as { ESLint: typeof ESLintType };
  const [major, minor] = ESLint.version.split('.').map(Number);
  if ((major !== 9 && major !== 10) || (major === 9 && minor < 30))
    throw new Error(`ESLint ${ESLint.version} is not supported. Use ESLint 9.30 or later in major version 9 or 10.`);
  const engine = new ESLint({
    cwd, fix: false, cache: false,
    ...(config ? { overrideConfigFile: resolve(cwd, config) } : {}),
    ruleFilter: ({ ruleId }) => isDesignRule(ruleId),
  });
  const results = await engine.lintFiles(patterns.length ? patterns : ['.']);
  const report: SourceReport = {
    kind: 'source', status: 'passed', engine: { name: 'eslint', version: ESLint.version },
    files: [], skipped: [], findings: [], errors: [],
  };
  for (const result of results) {
    const path = relative(cwd, result.filePath);
    const configured: Linter.Config | undefined = await engine.calculateConfigForFile(result.filePath);
    const rules = Object.entries(configured?.rules ?? {}).filter(([id, setting]) => {
      const severity = Array.isArray(setting) ? setting[0] : setting;
      return isDesignRule(id) && severity !== undefined && severity !== 0 && severity !== 'off';
    }).map(([id]) => id).sort();
    if (rules.length) report.files.push({ path, rules });
    else report.skipped.push({ path, reason: configured ? 'No shadcn/* design rules enabled.' : 'Ignored or no matching ESLint configuration.' });
    // Keep parser and configuration diagnostics, even though only design rules run.
    for (const message of result.messages) report.findings.push({ filePath: path, ...message });
    if (result.fatalErrorCount) report.errors.push(`Could not parse ${path}.`);
    if (result.messages.some(message => message.severity === 2 && message.ruleId === null && !message.fatal))
      report.errors.push(`ESLint could not check ${path}.`);
  }
  if (!report.files.length) report.errors.push('No files were checked with shadcn/* design rules. Configure @shadcn/lint and select matching source files.');
  report.status = report.errors.length ? 'incomplete' : report.findings.length ? 'failed' : 'passed';
  if (json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(terminalText([
      `Source check ${report.status}. Files with design rules: ${report.files.length}. Findings: ${report.findings.length}. Files without design checks: ${report.skipped.length}.`,
      `Engine: ESLint ${report.engine.version}. Only configured shadcn/* rules run. Browser checks did not run.`,
      ...report.files.map(file => `Checked ${file.path}: ${file.rules.join(', ')}`),
      ...report.skipped.map(file => `Skipped ${file.path}: ${file.reason}`),
      ...report.findings.map(f => `\n${f.filePath}:${f.line ?? 0}:${f.column ?? 0} ${f.ruleId ?? 'eslint'} (${f.fatal ? 'could not check' : f.severity === 1 ? 'warning' : 'error'})\n${f.message}${f.suggestions?.map(s => `\nSuggestion: ${s.desc}`).join('') ?? ''}`),
      ...report.errors,
    ].join('\n')));
  }
  return report.status === 'incomplete' ? 2 : report.status === 'failed' ? 1 : 0;
}
