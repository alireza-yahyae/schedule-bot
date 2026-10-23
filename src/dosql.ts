// A tiny stand-in for D1 on top of a Durable Object's SQLite storage.
// The whole bot is written against D1 (prepare / bind / first / all / run / batch); giving it this object
// instead lets every person have a private database without changing the rest of the code.

interface SqlCursorLike {
  toArray(): Record<string, unknown>[];
  raw(): IterableIterator<unknown[]>;
}
export interface StorageLike {
  sql: { exec(query: string, ...bindings: unknown[]): SqlCursorLike };
  transactionSync<T>(fn: () => T): T;
}

interface RunMeta {
  changes: number;
  last_row_id: number;
}
interface RunResult<T> {
  results: T[];
  success: true;
  meta: RunMeta;
}

export class DoStatement {
  private readonly storage: StorageLike;
  readonly sql: string;
  private readonly params: unknown[];

  constructor(storage: StorageLike, sql: string, params: unknown[] = []) {
    this.storage = storage;
    this.sql = sql;
    this.params = params;
  }

  bind(...values: unknown[]): DoStatement {
    return new DoStatement(this.storage, this.sql, values);
  }

  private rows(): Record<string, unknown>[] {
    return this.storage.sql.exec(this.sql, ...this.params).toArray();
  }

  /** Runs the statement and reads what it changed (the storage is single-threaded, so nothing can come in between). */
  runSync(): RunResult<Record<string, unknown>> {
    const results = this.rows();
    const m = this.storage.sql.exec('SELECT changes() AS c, last_insert_rowid() AS id').toArray()[0] ?? {};
    return { results, success: true, meta: { changes: Number(m.c ?? 0), last_row_id: Number(m.id ?? 0) } };
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = this.rows()[0];
    if (row === undefined) return null;
    if (column !== undefined) return (row[column] ?? null) as T | null;
    return row as T;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: true; meta: Record<string, never> }> {
    return { results: this.rows() as T[], success: true, meta: {} };
  }

  async run<T = Record<string, unknown>>(): Promise<RunResult<T>> {
    return this.runSync() as unknown as RunResult<T>;
  }

  async raw<T = unknown[]>(): Promise<T[]> {
    return [...this.storage.sql.exec(this.sql, ...this.params).raw()] as T[];
  }
}

export class DoDatabase {
  private readonly storage: StorageLike;

  constructor(storage: StorageLike) {
    this.storage = storage;
  }

  prepare(sql: string): DoStatement {
    return new DoStatement(this.storage, sql);
  }

  /** All statements or none (like D1's batch). */
  async batch(statements: DoStatement[]): Promise<RunResult<Record<string, unknown>>[]> {
    return this.storage.transactionSync(() => statements.map((s) => s.runSync()));
  }

  async exec(sql: string): Promise<void> {
    this.storage.sql.exec(sql).toArray();
  }
}
