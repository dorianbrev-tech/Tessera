import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { env } from "@/lib/env";

const g = globalThis as unknown as { __tesseraPool?: pg.Pool };

export const pool =
  g.__tesseraPool ??
  new pg.Pool({
    connectionString: env.databaseUrl,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
  });
if (process.env.NODE_ENV !== "production") g.__tesseraPool = pool;

export const db = drizzle(pool, { schema });
export { schema };
