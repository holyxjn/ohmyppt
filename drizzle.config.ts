import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/main/db/schema.ts",
  out: "./drizzle",
  dialect: "turso",
  dbCredentials: {
    url: process.env.DATABASE_URL || "./data/ohmyppt.db",
  },
});
