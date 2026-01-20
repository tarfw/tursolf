import { useEffect, useState, useCallback } from 'react';
import { getDb, syncWithRemote, type Todo } from './db';
import { Database } from '@tursodatabase/sync-wasm';
import { Loader2, RefreshCw, Plus, Check, Trash2, Database as DbIcon, Globe } from 'lucide-react';
import './index.css';

function App() {
  const [db, setDb] = useState<Database | null>(null);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);

  const fetchTodos = async (database: Database) => {
    const rows = await database.prepare("SELECT * FROM todos WHERE is_deleted = 0 ORDER BY created_at DESC").all();
    setTodos(rows as unknown as Todo[]);
  };

  const handleSync = useCallback(async (silent = false) => {
    if (!db || syncing) return;
    if (!silent) setSyncing(true);
    setError(null);
    if (!silent) setSyncStatus('Syncing...');

    try {
      await syncWithRemote(db);
      await fetchTodos(db);
      setLastSynced(new Date());
      if (!silent) {
        setSyncStatus('Synced');
        setTimeout(() => setSyncStatus('Ready'), 2000);
      }
    } catch (e: any) {
      console.error(e);
      if (!silent) {
        setError("Sync failed. Check Fly.io logs or CORS.");
        setSyncStatus('Error');
      }
    } finally {
      if (!silent) setSyncing(false);
    }
  }, [db, syncing]);

  // Auto-sync every 10 seconds
  useEffect(() => {
    if (!db) return;

    const interval = setInterval(() => {
      handleSync(true); // Silent sync in background
    }, 3000); // Updated to 3 seconds

    return () => clearInterval(interval);
  }, [db, handleSync]);

  const initDb = useCallback(async () => {
    try {
      setSyncStatus('Connecting...');
      const _db = await getDb();
      setDb(_db);

      setSyncStatus('Downloading tasks...');
      await syncWithRemote(_db);
      await fetchTodos(_db);
      setLastSynced(new Date());

      setSyncStatus('Ready');
    } catch (e: any) {
      console.error(e);
      setError(e.message || 'Failed to initialize database');
      setSyncStatus('Error');
    }
  }, []);

  useEffect(() => {
    initDb();
  }, [initDb]);

  const handleAddTodo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || !db) return;

    try {
      await db.prepare("INSERT INTO todos (text) VALUES (?)").run(inputValue);
      setInputValue('');
      await fetchTodos(db);
      // Trigger a sync soon after adding
      setTimeout(() => handleSync(true), 1000);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleToggleTodo = async (id: number, currentStatus: number) => {
    if (!db) return;
    try {
      // Mark as dirty so sync knows to push the update
      await db.prepare("UPDATE todos SET completed = ?, dirty = 1 WHERE id = ?").run(currentStatus ? 0 : 1, id);
      await fetchTodos(db);
      // Trigger a sync soon after change
      setTimeout(() => handleSync(true), 1000);
    } catch (e: any) {
      console.error(e);
    }
  };

  const handleDeleteTodo = async (id: number) => {
    if (!db) return;
    try {
      // Mark as deleted and dirty so sync knows to push the deletion
      await db.prepare("UPDATE todos SET is_deleted = 1, dirty = 1 WHERE id = ?").run(id);
      await fetchTodos(db);
      // Trigger a sync soon after delete
      setTimeout(() => handleSync(true), 1000);
    } catch (e: any) {
      console.error(e);
    }
  };

  if (!db) {
    return (
      <div className="loading-screen">
        {error ? (
          <div className="init-error">
            <DbIcon className="icon-error" size={48} />
            <h2>Initialization Failed</h2>
            <p className="error-message">{error}</p>
            <button onClick={() => window.location.reload()} className="retry-btn">
              <RefreshCw size={16} />
              Retry Connection
            </button>
          </div>
        ) : (
          <>
            <Loader2 className="spinner" size={48} />
            <p>{syncStatus || 'Initializing embedded database...'}</p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo-badge">
          <DbIcon className="icon-success" />
          <span className="plus">+</span>
          <Globe className="icon-accent" />
        </div>
        <h1>Turso Sync</h1>
        <p className="subtitle">Local-first React app with embedded SQLite</p>
      </header>

      <div className="main-card">
        <div className="card-header">
          <h2>
            <span className="indicator"></span>
            Tasks
          </h2>
          <div className="status-indicator">
            {syncStatus && <span className="status-text">{syncStatus}</span>}
            <button
              onClick={() => handleSync(false)}
              disabled={syncing}
              className={`sync-btn ${syncing ? 'syncing' : ''}`}
            >
              <RefreshCw size={16} className={syncing ? 'spin' : ''} />
              {syncing ? 'Syncing...' : 'Sync'}
            </button>
          </div>
        </div>

        <div className="sync-info">
          {lastSynced && (
            <p className="last-synced">
              Last synced: {lastSynced.toLocaleTimeString()}
            </p>
          )}
        </div>

        <form onSubmit={handleAddTodo} className="input-group">
          <Plus className="input-icon" size={24} />
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="What needs to be done?"
            autoFocus
          />
        </form>

        <div className="todo-list">
          {todos.length === 0 ? (
            <div className="empty-state">
              No tasks yet. Add one to get started!
            </div>
          ) : (
            todos.map((todo) => (
              <div
                key={todo.id}
                className={`todo-item ${todo.completed ? 'completed' : ''}`}
              >
                <div className="todo-content">
                  <button
                    onClick={() => handleToggleTodo(todo.id, todo.completed)}
                    className="check-btn"
                  >
                    {!!todo.completed && <Check size={14} />}
                  </button>
                  <span className="todo-text">
                    {todo.text}
                  </span>
                </div>
                <button
                  onClick={() => handleDeleteTodo(todo.id)}
                  className="delete-btn"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {error && (
        <div className="error-toast">
          <p className="error-title">Error</p>
          <p className="error-msg">{error}</p>
        </div>
      )}
    </div>
  );
}

export default App;
