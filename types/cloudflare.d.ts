/**
 * The Worker's bindings and secrets, as the app uses them (see wrangler.jsonc). Hand-written
 * rather than generated: `wrangler types` emits the whole Workers runtime, which clashes with
 * the DOM types the client code needs. Only the parts of D1 this app calls are declared.
 */
interface CloudflareEnv {
  DB: D1Database;
  /** Workers AI, for embeddings. Absent where the Worker has no AI binding. */
  AI?: Ai;
  VECTORIZE?: VectorizeIndex;
  SESSION_SECRET?: string;
  OWNER_PASSWORD?: string;
  /** The search index namespace; "dev" keeps local runs apart from the live site's vectors. */
  SEARCH_NAMESPACE?: string;
}

/** Workers AI: only text embeddings are used. */
interface Ai {
  run(model: string, input: { queries?: string | string[]; documents?: string | string[]; text?: string | string[] }): Promise<{ data: number[][]; shape: number[] }>;
}

interface VectorizeVector {
  id: string;
  values: number[];
  namespace?: string;
  metadata?: Record<string, string | number | boolean>;
}

interface VectorizeIndex {
  upsert(vectors: VectorizeVector[]): Promise<{ mutationId: string }>;
  deleteByIds(ids: string[]): Promise<{ mutationId: string }>;
  query(
    vector: number[],
    options?: { topK?: number; namespace?: string; returnValues?: boolean; returnMetadata?: boolean | "none" | "indexed" | "all" },
  ): Promise<{ count: number; matches: { id: string; score: number }[] }>;
}

interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: { changes: number; last_row_id: number; duration: number };
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}
