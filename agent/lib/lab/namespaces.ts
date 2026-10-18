import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { config, now, service } from "./runtime.ts";

function database() {
  const db = new DatabaseSync(config().dbPath);
  db.exec(`PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS lab_namespaces(id TEXT PRIMARY KEY,created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS lab_namespace_active(singleton INTEGER PRIMARY KEY CHECK(singleton=1),id TEXT NOT NULL);
    INSERT OR IGNORE INTO lab_namespaces VALUES('default',0);
    INSERT OR IGNORE INTO lab_namespace_active VALUES(1,'default');`);
  return db;
}
export function currentNamespace() {
  const db = database();
  try {
    return db
      .prepare(
        "SELECT n.id,n.created_at AS createdAt FROM lab_namespaces n JOIN lab_namespace_active a ON n.id=a.id WHERE a.singleton=1",
      )
      .get()!;
  } finally {
    db.close();
  }
}
export async function resetNamespace() {
  const id = randomUUID(),
    createdAt = now();
  // Seed the independent receiver before publishing the new namespace locally.
  // A crash here may leave an unused seeded namespace, never erase prior data.
  await service("/namespaces", { namespace: id });
  const db = database();
  try {
    db.exec("BEGIN IMMEDIATE");
    db.prepare("INSERT INTO lab_namespaces VALUES(?,?)").run(id, createdAt);
    db.prepare("UPDATE lab_namespace_active SET id=? WHERE singleton=1").run(
      id,
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
  return { id, createdAt };
}
