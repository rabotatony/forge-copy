// ============================================================
// AxiomState Phase 1: AST-Graph Domain Model
// ============================================================

// Canonical key prefixes inside the LSS kernel.
export const KEY_PREFIXES = {
  node: 'ast://node/',
  edge: 'ast://edge/',
  meta: 'ast://meta',
};

export interface GraphNode {
  id: string;
  kind: 'file' | 'symbol';
  name: string;
  payload: Uint8Array;
  deps: string[];
}

export interface GraphEdge {
  from: string;
  to: string;
  meta?: Record<string, unknown>;
}

export interface GraphDelta {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphMeta {
  lastParseSeq: string;
  providerName: string;
  fileCount: number;
  nodeCount: number;
  edgeCount: number;
}

export interface SliceResult {
  startIds: string[];
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
}

export interface ParserProvider {
  name: string;
  canParse(filePath: string): boolean;
  parse(rootDir: string, filePath: string, content: Uint8Array): GraphDelta;
}
