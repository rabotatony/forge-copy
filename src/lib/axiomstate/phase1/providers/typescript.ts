import * as ts from 'typescript';
import * as path from 'node:path';
import { fileId, symbolId, resolveImport } from '../ids';
import type { ParserProvider, GraphDelta, GraphNode, GraphEdge } from '../types';

export class TypeScriptProvider implements ParserProvider {
  name = 'typescript';

  canParse(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx' || ext === '.mjs';
  }

  parse(rootDir: string, filePath: string, content: Uint8Array): GraphDelta {
    const text = new TextDecoder().decode(content);
    const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const fId = fileId(filePath);
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const fileDeps = new Set<string>();
    const importMap = new Map<string, string>(); // local alias -> target id

    const addEdge = (from: string, to: string): void => {
      if (from === to) return;
      edges.push({ from, to });
    };

    // Pass 1: collect imports.
    ts.forEachChild(sourceFile, (statement: ts.Node) => {
      if (!ts.isImportDeclaration(statement)) return;
      const moduleSpecifier = statement.moduleSpecifier;
      if (!ts.isStringLiteral(moduleSpecifier)) return;
      const resolved = resolveImport(rootDir, filePath, moduleSpecifier.text);
      if (!resolved) return;
      const clause = statement.importClause;
      if (!clause) {
        fileDeps.add(fileId(resolved));
        return;
      }
      if (clause.name) {
        importMap.set(clause.name.text, fileId(resolved));
        fileDeps.add(fileId(resolved));
      }
      if (clause.namedBindings) {
        if (ts.isNamedImports(clause.namedBindings)) {
          for (const spec of clause.namedBindings.elements) {
            const targetName = spec.propertyName?.text ?? spec.name.text;
            importMap.set(spec.name.text, symbolId(resolved, targetName));
            fileDeps.add(fileId(resolved));
          }
        } else if (ts.isNamespaceImport(clause.namedBindings)) {
          importMap.set(clause.namedBindings.name.text, fileId(resolved));
          fileDeps.add(fileId(resolved));
        }
      }
    });

    // Pass 2: collect exported declarations and symbol-level edges.
    const symbolNodes: GraphNode[] = [];
    ts.forEachChild(sourceFile, (statement: ts.Node) => {
      if (!isExported(statement)) return;
      const names = getExportedNames(statement);
      for (const name of names) {
        const sId = symbolId(filePath, name);
        const kind = getSymbolKind(statement);
        const deps: string[] = [fId];
        const payload = { kind: 'symbol', name, path: filePath, symbolKind: kind, deps };
        symbolNodes.push({
          id: sId,
          kind: 'symbol',
          name,
          payload: new TextEncoder().encode(JSON.stringify(payload)),
          deps,
        });
        addEdge(sId, fId);
        // Wire references to imported symbols.
        ts.forEachChild(statement, function visitRef(node: ts.Node) {
          if (ts.isIdentifier(node)) {
            const target = importMap.get(node.text);
            if (target) { deps.push(target); addEdge(sId, target); }
          }
          ts.forEachChild(node, visitRef);
        });
      }
    });

    // File node.
    const fileDepsArr = Array.from(fileDeps);
    const filePayload = {
      kind: 'file',
      name: path.basename(filePath),
      path: filePath,
      deps: fileDepsArr,
    };
    nodes.push({
      id: fId,
      kind: 'file',
      name: path.basename(filePath),
      payload: new TextEncoder().encode(JSON.stringify(filePayload)),
      deps: fileDepsArr,
    });
    for (const dep of fileDeps) addEdge(fId, dep);
    nodes.push(...symbolNodes);

    return { nodes, edges };
  }
}

function isExported(node: ts.Node): boolean {
  if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node) || ts.isVariableStatement(node)) {
    const mods = ts.getModifiers(node);
    return mods?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
  }
  return false;
}

function getExportedNames(node: ts.Node): string[] {
  if (ts.isFunctionDeclaration(node) && node.name) return [node.name.text];
  if (ts.isClassDeclaration(node) && node.name) return [node.name.text];
  if (ts.isInterfaceDeclaration(node)) return [node.name.text];
  if (ts.isTypeAliasDeclaration(node)) return [node.name.text];
  if (ts.isEnumDeclaration(node)) return [node.name.text];
  if (ts.isVariableStatement(node)) {
    return node.declarationList.declarations
      .filter(d => ts.isIdentifier(d.name))
      .map(d => (d.name as ts.Identifier).text);
  }
  return [];
}

function getSymbolKind(node: ts.Node): string {
  if (ts.isFunctionDeclaration(node)) return 'function';
  if (ts.isClassDeclaration(node)) return 'class';
  if (ts.isInterfaceDeclaration(node)) return 'interface';
  if (ts.isTypeAliasDeclaration(node)) return 'type';
  if (ts.isEnumDeclaration(node)) return 'enum';
  if (ts.isVariableStatement(node)) return 'variable';
  return 'declaration';
}
