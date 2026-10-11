import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { connection } from "next/server";

/**
 * The D1 database (schema in migrations/). Reading it means the page needs a request: it can't
 * be prerendered at build time, so callers render inside <Suspense> (see the Next.js caching guide).
 */
export async function db(): Promise<D1Database> {
  await connection();
  return (await getCloudflareContext({ async: true })).env.DB;
}

/** Rows keep their record whole, as JSON, in `data`. */
export const records = <T,>(rows: { data: string }[]): T[] => rows.map((row) => JSON.parse(row.data) as T);

/** D1 caps how many statements one batch can hold; larger writes go in slices. */
export async function batched(database: D1Database, statements: D1PreparedStatement[], size = 50) {
  for (let i = 0; i < statements.length; i += size) await database.batch(statements.slice(i, i + size));
}
