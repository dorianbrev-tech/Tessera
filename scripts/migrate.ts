import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "@/lib/db";

await migrate(db, { migrationsFolder: "./drizzle" });
console.log("✓ database migrated");
await pool.end();
