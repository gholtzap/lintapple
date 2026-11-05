import { basename, dirname, resolve } from 'node:path';
import ts from 'typescript';

type BrowserFunction = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction;

// Inspect emitted JavaScript so type-only names do not count as captured values.
export function inspectBrowserFunctions(files: string[]): { functions: string[]; violations: string[] } {
  const options: ts.CompilerOptions = {
    allowJs: true, noEmit: true, target: ts.ScriptTarget.ES2023,
    module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    types: [], lib: ['lib.es2023.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
  };
  const host = ts.createCompilerHost(options);
  // A sibling declaration file must not replace the JavaScript being checked.
  host.resolveModuleNames = (names, from) => names.map(name => {
    const file = resolve(dirname(from), name);
    if (name.startsWith('.') && name.endsWith('.js') && ts.sys.fileExists(file)) return { resolvedFileName: file, extension: ts.Extension.Js };
    return ts.resolveModuleName(name, from, options, host).resolvedModule;
  });
  const program = ts.createProgram(files, options, host);
  const checker = program.getTypeChecker();
  const functions = new Set<string>(), violations = new Set<string>();
  const checked = new Set<BrowserFunction>();
  const location = (node: ts.Node) => {
    const file = node.getSourceFile();
    return `${basename(file.fileName)}:${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
  };
  const contains = (fn: BrowserFunction, node: ts.Node) => node.getSourceFile() === fn.getSourceFile() && node.pos >= fn.pos && node.end <= fn.end;
  const unwrap = (node: ts.Expression): ts.Expression => ts.isParenthesizedExpression(node) ? unwrap(node.expression) : node;
  const inspect = (fn: BrowserFunction, name: string) => {
    if (checked.has(fn)) return;
    checked.add(fn);
    functions.add(`${location(fn)} ${name}`);
    const localContext = (node: ts.Node) => {
      let child = node;
      for (let scope = node.parent; scope && contains(fn, scope); child = scope, scope = scope.parent) {
        if (ts.isFunctionLike(scope) && !ts.isArrowFunction(scope) && scope.name !== child) return true;
        if (ts.isPropertyDeclaration(scope) && scope.initializer === child) return true;
        if (ts.isClassStaticBlockDeclaration(scope)) return true;
      }
      return false;
    };
    const visit = (node: ts.Node) => {
      const capturedContext = (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword)
        || ((node.kind === ts.SyntaxKind.ThisKeyword || node.kind === ts.SyntaxKind.SuperKeyword || ts.isMetaProperty(node)) && !localContext(node));
      if (capturedContext) {
        violations.add(`${location(node)}: browser function ${name} uses outside value ${node.getText()}. Use a parameter instead of captured context.`);
      }
      if (ts.isIdentifier(node)) {
        const parent = node.parent;
        // Property names, labels, and meta-property names are not variable lookups.
        const property = (ts.isPropertyAccessExpression(parent) && parent.name === node)
          || (ts.isPropertyAssignment(parent) && parent.name === node)
          || (ts.isBindingElement(parent) && parent.propertyName === node)
          || (ts.isLabeledStatement(parent) && parent.label === node)
          || ((ts.isBreakStatement(parent) || ts.isContinueStatement(parent)) && parent.label === node)
          || ts.isMetaProperty(parent);
        if (!property) {
          const symbol = ts.isShorthandPropertyAssignment(parent)
            ? checker.getShorthandAssignmentValueSymbol(parent) : checker.getSymbolAtLocation(node);
          const declarations = symbol?.declarations ?? [];
          const local = declarations.length > 0 && declarations.every(declaration => contains(fn, declaration) || program.isSourceFileDefaultLibrary(declaration.getSourceFile()));
          const intrinsic = declarations.length === 0 && (node.text === 'undefined' || (node.text === 'arguments' && localContext(node)));
          if (!local && !intrinsic) violations.add(`${location(node)}: browser function ${name} uses outside value ${node.text}. Pass it as an argument or define it inside the function.`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(fn);
  };
  // shortcut: function parameters need a direct checked call until browser code is bundled.
  const find = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'toString') {
      const target = unwrap(node.expression.expression);
      const type = checker.getTypeAtLocation(target);
      let symbol = checker.getSymbolAtLocation(target);
      if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
      const declaration = symbol?.valueDeclaration;
      const fn = ts.isArrowFunction(target) || ts.isFunctionExpression(target) ? target
        : declaration && ts.isFunctionDeclaration(declaration) ? declaration
        : declaration && ts.isVariableDeclaration(declaration) && declaration.initializer ? unwrap(declaration.initializer) : undefined;
      if (fn && (ts.isFunctionDeclaration(fn) || ts.isFunctionExpression(fn) || ts.isArrowFunction(fn))) inspect(fn, target.getText());
      else if (type.getCallSignatures().length) {
        violations.add(`${location(target)}: Cannot inspect browser function ${target.getText()}. Use a function declaration or a function variable.`);
      }
    }
    ts.forEachChild(node, find);
  };
  for (const file of files) if (!program.getSourceFile(file)) throw new Error(`Cannot read browser function source: ${file}`);
  for (const source of program.getSourceFiles()) if (!source.isDeclarationFile && !program.isSourceFileFromExternalLibrary(source)) find(source);
  return { functions: [...functions], violations: [...violations] };
}
