import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import ts from 'typescript';

const root = fileURLToPath(new URL('../../', import.meta.url));

test('TypeScript source has no explicit or inferred any types or disabled type checks', async () => {
  const config = ts.getParsedCommandLineOfConfigFile(`${root}tsconfig.json`, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: diagnostic => assert.fail(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')),
  });
  assert.ok(config);
  const program = ts.createProgram(config.fileNames, config.options);
  const checker = program.getTypeChecker();
  const violations: string[] = [];
  for (const file of program.getSourceFiles()) {
    if (!file.fileName.startsWith(root) || file.fileName.includes('/node_modules/') || file.isDeclarationFile) continue;
    const name = file.fileName.slice(root.length);
    const visit = (node: ts.Node) => {
      if (node.kind === ts.SyntaxKind.AnyKeyword) violations.push(`${name}: explicit any type`);
      if (ts.isVariableDeclaration(node) || ts.isParameter(node)) {
        const type = checker.typeToString(checker.getTypeAtLocation(node.name));
        if (/\bany\b/.test(type)) violations.push(`${name}: ${node.name.getText(file)} has type ${type}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
    const source = await readFile(file.fileName, 'utf8');
    if (/\/\/\s*@ts-(?:ignore|nocheck)\b/.test(source)) violations.push(`${name}: disabled type checks`);
  }
  assert.deepEqual(violations, []);
});
