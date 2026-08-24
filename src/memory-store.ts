import pg from "pg";

const { Pool } = pg;

export interface MemoryEntry {
  authorId?: string;
  createdAt?: Date;
  id?: number;
  key: string;
  scope: string;
  updatedAt?: Date;
  value: string;
}

export interface MemoryStoreOptions {
  databaseUrl?: string;
  enabled?: boolean;
  maxKeyChars?: number;
  maxPerScope?: number;
  maxValueChars?: number;
  pool?: pg.Pool;
}

export interface MemoryDbRow {
  author_id: string | null;
  created_at: Date;
  id: number;
  key: string;
  scope: string;
  updated_at: Date;
  value: string;
}

export class MemoryStore {
  private readonly pool?: pg.Pool;
  private readonly enabled: boolean;
  private readonly maxKeyChars: number;
  private readonly maxValueChars: number;
  private readonly maxPerScope: number;
  private initialized = false;
  private initPromise?: Promise<void>;
  // Fast in-memory cache layer: scope -> (lowerKey -> MemoryEntry)
  private readonly cache = new Map<string, Map<string, MemoryEntry>>();

  public constructor(options: MemoryStoreOptions = {}) {
    this.maxKeyChars = options.maxKeyChars ?? 100;
    this.maxValueChars = options.maxValueChars ?? 1000;
    this.maxPerScope = options.maxPerScope ?? 100;

    const rawUrl = options.databaseUrl?.trim();
    this.enabled = (options.enabled !== false) && (Boolean(rawUrl) || Boolean(options.pool));

    if (this.enabled) {
      if (options.pool) {
        this.pool = options.pool;
      } else if (rawUrl) {
        // Strip sslmode parameter from query string so node-postgres pg.Pool
        // respects our explicit ssl: { rejectUnauthorized: false } config for Aiven
        const cleanUrl = rawUrl.replace(/[?&]sslmode=[^&]+/i, "");
        this.pool = new Pool({
          connectionString: cleanUrl,
          connectionTimeoutMillis: 10_000,
          idleTimeoutMillis: 30_000,
          max: 3,
          ssl: { rejectUnauthorized: false },
        });
      }
    }
  }

  public isEnabled(): boolean {
    return this.enabled && Boolean(this.pool);
  }

  public async init(): Promise<void> {
    if (!this.isEnabled() || !this.pool) {
      return;
    }

    if (this.initialized) {
      return;
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      const query = `
        CREATE TABLE IF NOT EXISTS memories (
          id SERIAL PRIMARY KEY,
          scope VARCHAR(64) NOT NULL,
          key VARCHAR(200) NOT NULL,
          value TEXT NOT NULL,
          author_id VARCHAR(64),
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          CONSTRAINT uq_memories_scope_key UNIQUE (scope, key)
        );
        CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope);
      `;

      try {
        await this.pool!.query(query);
        this.initialized = true;
      } catch (error) {
        console.error("Failed to initialize PostgreSQL memories table", error);
        throw error;
      } finally {
        this.initPromise = undefined;
      }
    })();

    return this.initPromise;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized && this.isEnabled()) {
      try {
        await this.init();
      } catch {
        // Ignore initialization errors so operations can attempt query or fallback
      }
    }
  }

  public async remember(
    scope: string,
    key: string,
    value: string,
    authorId?: string,
  ): Promise<{ created: boolean; entry: MemoryEntry }> {
    if (!this.isEnabled() || !this.pool) {
      throw new Error("Memory store is not enabled or configured with a database.");
    }

    await this.ensureInitialized();

    const trimmedKey = key.trim();
    const trimmedValue = value.trim();

    if (!trimmedKey) {
      throw new Error("Memory key cannot be empty.");
    }
    if (!trimmedValue) {
      throw new Error("Memory value cannot be empty.");
    }
    if (trimmedKey.length > this.maxKeyChars) {
      throw new Error(`Memory key exceeds ${this.maxKeyChars} characters.`);
    }
    if (trimmedValue.length > this.maxValueChars) {
      throw new Error(`Memory value exceeds ${this.maxValueChars} characters.`);
    }

    // Check if entry already exists in DB (case-insensitive lookup)
    const existing = await this.get(scope, trimmedKey);

    if (!existing) {
      // Check scope capacity limit
      const countRes = await this.pool.query<{ count: string }>(
        "SELECT COUNT(*) AS count FROM memories WHERE scope = $1",
        [scope],
      );
      const count = parseInt(countRes.rows[0]?.count ?? "0", 10);
      if (count >= this.maxPerScope) {
        throw new Error(
          `Memory limit reached (${this.maxPerScope} entries for this scope). Delete older memories to add new ones.`,
        );
      }
    }

    const targetKey = existing ? existing.key : trimmedKey;

    const upsertQuery = `
      INSERT INTO memories (scope, key, value, author_id, updated_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (scope, key)
      DO UPDATE SET
        value = EXCLUDED.value,
        author_id = EXCLUDED.author_id,
        updated_at = NOW()
      RETURNING *;
    `;

    const result = await this.pool.query<MemoryDbRow>(upsertQuery, [
      scope,
      targetKey,
      trimmedValue,
      authorId ?? null,
    ]);

    const row = result.rows[0];
    if (!row) {
      throw new Error("Failed to save memory.");
    }

    const entry: MemoryEntry = {
      authorId: row.author_id ?? undefined,
      createdAt: row.created_at,
      id: row.id,
      key: row.key,
      scope: row.scope,
      updatedAt: row.updated_at,
      value: row.value,
    };

    // Update in-memory cache
    this.getScopeCache(scope).set(targetKey.toLowerCase(), entry);

    return {
      created: !existing,
      entry,
    };
  }

  public async get(scope: string, key: string): Promise<MemoryEntry | undefined> {
    if (!this.isEnabled() || !this.pool) {
      return undefined;
    }

    await this.ensureInitialized();

    const lowerKey = key.trim().toLowerCase();

    try {
      const query = `
        SELECT * FROM memories
        WHERE scope = $1 AND LOWER(key) = LOWER($2)
        LIMIT 1;
      `;

      const result = await this.pool.query<MemoryDbRow>(query, [scope, key.trim()]);
      const row = result.rows[0];
      if (!row) {
        return undefined;
      }

      const entry: MemoryEntry = {
        authorId: row.author_id ?? undefined,
        createdAt: row.created_at,
        id: row.id,
        key: row.key,
        scope: row.scope,
        updatedAt: row.updated_at,
        value: row.value,
      };

      this.getScopeCache(scope).set(lowerKey, entry);
      return entry;
    } catch {
      // Fall back to memory cache if DB is temporarily unreachable
      return this.getScopeCache(scope).get(lowerKey);
    }
  }

  public async forget(scope: string, key: string): Promise<boolean> {
    if (!this.isEnabled() || !this.pool) {
      return false;
    }

    await this.ensureInitialized();

    const lowerKey = key.trim().toLowerCase();
    this.getScopeCache(scope).delete(lowerKey);

    const query = `
      DELETE FROM memories
      WHERE scope = $1 AND LOWER(key) = LOWER($2);
    `;

    const result = await this.pool.query(query, [scope, key.trim()]);
    return (result.rowCount ?? 0) > 0;
  }

  public async forgetAll(scope: string): Promise<number> {
    if (!this.isEnabled() || !this.pool) {
      return 0;
    }

    await this.ensureInitialized();

    this.cache.delete(scope);

    const query = `
      DELETE FROM memories
      WHERE scope = $1;
    `;

    const result = await this.pool.query(query, [scope]);
    return result.rowCount ?? 0;
  }

  public async list(scope: string): Promise<MemoryEntry[]> {
    if (!this.isEnabled() || !this.pool) {
      return [];
    }

    await this.ensureInitialized();

    try {
      const query = `
        SELECT * FROM memories
        WHERE scope = $1
        ORDER BY updated_at DESC;
      `;

      const result = await this.pool.query<MemoryDbRow>(query, [scope]);
      const entries = result.rows.map((row) => ({
        authorId: row.author_id ?? undefined,
        createdAt: row.created_at,
        id: row.id,
        key: row.key,
        scope: row.scope,
        updatedAt: row.updated_at,
        value: row.value,
      }));

      const scopeCache = this.getScopeCache(scope);
      scopeCache.clear();
      for (const entry of entries) {
        scopeCache.set(entry.key.toLowerCase(), entry);
      }

      return entries;
    } catch {
      return Array.from(this.getScopeCache(scope).values());
    }
  }

  public async getMemoriesForContext(
    userScope: string,
    guildScope?: string,
  ): Promise<MemoryEntry[]> {
    if (!this.isEnabled() || !this.pool) {
      return [];
    }

    await this.ensureInitialized();

    const scopes = [userScope];
    if (guildScope && guildScope !== userScope) {
      scopes.push(guildScope);
    }

    try {
      const placeholders = scopes.map((_, i) => `$${i + 1}`).join(", ");
      const query = `
        SELECT * FROM memories
        WHERE scope IN (${placeholders})
        ORDER BY updated_at DESC
        LIMIT 100;
      `;

      const result = await this.pool.query<MemoryDbRow>(query, scopes);
      return result.rows.map((row) => ({
        authorId: row.author_id ?? undefined,
        createdAt: row.created_at,
        id: row.id,
        key: row.key,
        scope: row.scope,
        updatedAt: row.updated_at,
        value: row.value,
      }));
    } catch {
      const results: MemoryEntry[] = [];
      for (const s of scopes) {
        results.push(...this.getScopeCache(s).values());
      }
      return results;
    }
  }

  public formatForPrompt(memories: readonly MemoryEntry[]): string {
    if (memories.length === 0) {
      return "";
    }

    const lines = memories.map((m) => `- ${m.key}: ${m.value}`);
    return `[IMPORTANT CONTEXT: Saved Memories & Abbreviations]\nThe user/server has taught you the following abbreviations, definitions, and facts. You MUST prioritize and accurately apply them in your response:\n${lines.join(
      "\n",
    )}`;
  }

  public async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
    }
  }

  private getScopeCache(scope: string): Map<string, MemoryEntry> {
    let scopeMap = this.cache.get(scope);
    if (!scopeMap) {
      scopeMap = new Map();
      this.cache.set(scope, scopeMap);
    }
    return scopeMap;
  }
}
