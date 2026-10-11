/**
 * The Worker's bindings and secrets, as the app uses them (see wrangler.jsonc). Hand-written
 * rather than generated: `wrangler types` emits the whole Workers runtime, which clashes with
 * the DOM types the client code needs. Only the parts of D1 this app calls are declared.
 */
interface CloudflareEnv {
  DB: D1Database;
  SESSION_SECRET?: string;
  OWNER_PASSWORD?: string;
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
