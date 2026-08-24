import { describe, expect, it, vi } from "vitest";
import { MemoryStore, type MemoryDbRow } from "../src/memory-store.js";
import type pg from "pg";

function createMockPool(): {
  mockQuery: ReturnType<typeof vi.fn>;
  pool: pg.Pool;
  rows: MemoryDbRow[];
} {
  const rows: MemoryDbRow[] = [];
  let nextId = 1;

  const mockQuery = vi.fn(async (text: string, params?: unknown[]) => {
    const trimmed = text.trim().toLowerCase();

    if (trimmed.startsWith("create table") || trimmed.startsWith("create index")) {
      return { rowCount: 0, rows: [] };
    }

    if (trimmed.startsWith("select count(*)")) {
      const scope = params?.[0] as string;
      const count = rows.filter((r) => r.scope === scope).length;
      return { rowCount: 1, rows: [{ count: String(count) }] };
    }

    if (trimmed.startsWith("select * from memories where scope = $1 and lower(key) = lower($2)")) {
      const scope = params?.[0] as string;
      const key = (params?.[1] as string).toLowerCase();
      const found = rows.find((r) => r.scope === scope && r.key.toLowerCase() === key);
      return { rowCount: found ? 1 : 0, rows: found ? [found] : [] };
    }

    if (trimmed.startsWith("select * from memories where scope = any")) {
      const scopes = (params?.[0] as string[]) ?? [];
      const matches = rows.filter((r) => scopes.includes(r.scope));
      return { rowCount: matches.length, rows: matches };
    }

    if (trimmed.startsWith("select * from memories where scope = $1 order by updated_at desc")) {
      const scope = params?.[0] as string;
      const matches = rows.filter((r) => r.scope === scope);
      return { rowCount: matches.length, rows: matches };
    }

    if (trimmed.startsWith("insert into memories")) {
      const scope = params?.[0] as string;
      const key = params?.[1] as string;
      const value = params?.[2] as string;
      const authorId = (params?.[3] as string) ?? null;

      const existingIndex = rows.findIndex(
        (r) => r.scope === scope && r.key.toLowerCase() === key.toLowerCase(),
      );

      const now = new Date();
      if (existingIndex >= 0) {
        rows[existingIndex] = {
          ...rows[existingIndex]!,
          author_id: authorId,
          updated_at: now,
          value,
        };
        return { rowCount: 1, rows: [rows[existingIndex]!] };
      }

      const newRow: MemoryDbRow = {
        author_id: authorId,
        created_at: now,
        id: nextId++,
        key,
        scope,
        updated_at: now,
        value,
      };
      rows.push(newRow);
      return { rowCount: 1, rows: [newRow] };
    }

    if (trimmed.startsWith("delete from memories where scope = $1 and lower(key) = lower($2)")) {
      const scope = params?.[0] as string;
      const key = (params?.[1] as string).toLowerCase();
      const initialLen = rows.length;
      const index = rows.findIndex((r) => r.scope === scope && r.key.toLowerCase() === key);
      if (index >= 0) {
        rows.splice(index, 1);
      }
      return { rowCount: initialLen - rows.length, rows: [] };
    }

    if (trimmed.startsWith("delete from memories where scope = $1")) {
      const scope = params?.[0] as string;
      const initialLen = rows.length;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i]?.scope === scope) {
          rows.splice(i, 1);
        }
      }
      return { rowCount: initialLen - rows.length, rows: [] };
    }

    return { rowCount: 0, rows: [] };
  });

  const pool = {
    end: vi.fn(async () => undefined),
    query: mockQuery,
  } as unknown as pg.Pool;

  return { mockQuery, pool, rows };
}

describe("MemoryStore", () => {
  it("reports disabled when no database is provided", () => {
    const store = new MemoryStore({ enabled: true });
    expect(store.isEnabled()).toBe(false);
  });

  it("initializes table schema on init()", async () => {
    const { pool, mockQuery } = createMockPool();
    const store = new MemoryStore({ enabled: true, pool });
    expect(store.isEnabled()).toBe(true);

    await store.init();
    expect(mockQuery).toHaveBeenCalled();
    expect(String(mockQuery.mock.calls[0]?.[0])).toContain("CREATE TABLE IF NOT EXISTS memories");
  });

  it("saves, retrieves (case-insensitively), and updates memories", async () => {
    const { pool } = createMockPool();
    const store = new MemoryStore({ enabled: true, pool });

    // Remember abbreviation
    const res1 = await store.remember("user:123", "BRB", "Be Right Back", "123");
    expect(res1.created).toBe(true);
    expect(res1.entry.key).toBe("BRB");
    expect(res1.entry.value).toBe("Be Right Back");

    // Case-insensitive lookup
    const retrieved = await store.get("user:123", "brb");
    expect(retrieved).toBeDefined();
    expect(retrieved?.value).toBe("Be Right Back");

    // Update memory
    const res2 = await store.remember("user:123", "brb", "Be Right Back (updating)", "123");
    expect(res2.created).toBe(false);
    expect(res2.entry.value).toBe("Be Right Back (updating)");

    const updated = await store.get("user:123", "BRB");
    expect(updated?.value).toBe("Be Right Back (updating)");
  });

  it("enforces key length, value length, and scope capacity limits", async () => {
    const { pool } = createMockPool();
    const store = new MemoryStore({
      enabled: true,
      maxKeyChars: 10,
      maxPerScope: 2,
      maxValueChars: 20,
      pool,
    });

    await expect(
      store.remember("user:123", "this key is way too long", "val"),
    ).rejects.toThrow("Memory key exceeds 10 characters.");

    await expect(
      store.remember("user:123", "key", "this value is way too long for limits"),
    ).rejects.toThrow("Memory value exceeds 20 characters.");

    await store.remember("user:123", "k1", "v1");
    await store.remember("user:123", "k2", "v2");

    // Third entry should be rejected due to maxPerScope = 2
    await expect(
      store.remember("user:123", "k3", "v3"),
    ).rejects.toThrow("Memory limit reached");
  });

  it("deletes individual memories and clears scopes", async () => {
    const { pool } = createMockPool();
    const store = new MemoryStore({ enabled: true, pool });

    await store.remember("user:123", "AFK", "Away From Keyboard");
    await store.remember("user:123", "BRB", "Be Right Back");

    expect(await store.forget("user:123", "afk")).toBe(true);
    expect(await store.get("user:123", "AFK")).toBeUndefined();
    expect(await store.get("user:123", "BRB")).toBeDefined();

    const clearedCount = await store.forgetAll("user:123");
    expect(clearedCount).toBe(1);
    expect(await store.list("user:123")).toEqual([]);
  });

  it("fetches context combining user and guild scopes and formats for AI prompt", async () => {
    const { pool } = createMockPool();
    const store = new MemoryStore({ enabled: true, pool });

    await store.remember("user:123", "tz", "UTC+2");
    await store.remember("guild:456", "project", "aidiscord bot");

    const memories = await store.getMemoriesForContext("user:123", "guild:456");
    expect(memories).toHaveLength(2);

    const promptText = store.formatForPrompt(memories);
    expect(promptText).toContain("[Saved Memories & Abbreviations]");
    expect(promptText).toContain("- tz: UTC+2");
    expect(promptText).toContain("- project: aidiscord bot");
  });
});
