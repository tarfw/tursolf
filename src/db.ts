import { connect as connectLocal, Database } from '@tursodatabase/sync-wasm';
import { createClient } from '@libsql/client/web';

let localDbPromise: Promise<Database> | null = null;

// Remote client for Fly.io
const remoteClient = createClient({
  url: import.meta.env.VITE_TURSO_DB_URL.replace('libsql://', 'https://'), // Ensure https for web client
  authToken: import.meta.env.VITE_TURSO_AUTH_TOKEN,
});

export const getDb = async (): Promise<Database> => {
  if (localDbPromise) return localDbPromise;

  localDbPromise = (async () => {
    console.log("Initializing in-memory database...");

    try {
      const db = await connectLocal({
        path: ':memory:',
      });

      await db.exec(`
        CREATE TABLE IF NOT EXISTS todos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          remote_id INTEGER UNIQUE,
          text TEXT NOT NULL,
          completed INTEGER DEFAULT 0,
          dirty INTEGER DEFAULT 0,
          is_deleted INTEGER DEFAULT 0,
          created_at INTEGER DEFAULT (unixepoch())
        );
      `);

      return db;
    } catch (e: any) {
      console.error("Connection error:", e);
      throw e;
    }
  })();

  return localDbPromise;
};

// Manual Sync Logic
export const syncWithRemote = async (localDb: Database) => {
  console.log("Syncing with Fly.io...");

  try {
    // 1. PUSH: Find local items that are new, updated, or deleted
    const localChanges = await localDb.prepare("SELECT * FROM todos WHERE remote_id IS NULL OR dirty = 1").all();

    for (const todo of (localChanges as any[])) {
      if (todo.is_deleted === 1) {
        // DELETE ON REMOTE
        if (todo.remote_id) {
          await remoteClient.execute({
            sql: "DELETE FROM todos WHERE id = ?",
            args: [todo.remote_id]
          });
        }
        // Permanently remove locally now that it's synced
        await localDb.prepare("DELETE FROM todos WHERE id = ?").run(todo.id);
      }
      else if (!todo.remote_id) {
        // NEW ITEM
        const result = await remoteClient.execute({
          sql: "INSERT INTO todos (text, completed) VALUES (?, ?) RETURNING id",
          args: [todo.text, todo.completed]
        });
        const remoteId = result.rows[0].id;
        await localDb.prepare("UPDATE todos SET remote_id = ?, dirty = 0 WHERE id = ?").run(remoteId, todo.id);
      }
      else {
        // UPDATED ITEM
        await remoteClient.execute({
          sql: "UPDATE todos SET text = ?, completed = ? WHERE id = ?",
          args: [todo.text, todo.completed, todo.remote_id]
        });
        await localDb.prepare("UPDATE todos SET dirty = 0 WHERE id = ?").run(todo.id);
      }
    }

    // 2. PULL: Get everything from remote and update local
    const remoteTodos = await remoteClient.execute("SELECT * FROM todos");
    const remoteIds = remoteTodos.rows.map(r => r.id);

    // Remote deletes: If we have a remote_id that is NOT in the remote list, delete it locally
    // (Only if it's not currently dirty/deleted locally)
    if (remoteIds.length > 0) {
      const placeholders = remoteIds.map(() => '?').join(',');
      await localDb.prepare(`
            DELETE FROM todos 
            WHERE remote_id IS NOT NULL 
            AND remote_id NOT IN (${placeholders})
            AND dirty = 0
        `).run(...remoteIds);
    } else {
      await localDb.prepare("DELETE FROM todos WHERE remote_id IS NOT NULL AND dirty = 0").run();
    }

    for (const row of remoteTodos.rows) {
      await localDb.prepare(`
        INSERT INTO todos (remote_id, text, completed, dirty, is_deleted) 
        VALUES (?, ?, ?, 0, 0)
        ON CONFLICT(remote_id) DO UPDATE SET
          text = CASE WHEN dirty = 0 THEN excluded.text ELSE todos.text END,
          completed = CASE WHEN dirty = 0 THEN excluded.completed ELSE todos.completed END
      `).run(row.id, row.text, row.completed);
    }

    console.log("Sync completed!");
    return true;
  } catch (err) {
    console.error("Sync failed:", err);
    throw err;
  }
};

export interface Todo {
  id: number;
  remote_id: number | null;
  text: string;
  completed: number;
  dirty: number;
  is_deleted: number;
  created_at: number;
}
