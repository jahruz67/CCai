import pg from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../src/memory-store.js";

vi.mock("pg", async (importOriginal) => {
  const { default: actual } = await importOriginal<typeof import("pg")>();
  return {
    default: {
      ...actual,
      Pool: vi.fn(function (options: pg.PoolConfig) {
        return new actual.Pool(options);
      }),
    },
  };
});

afterEach(() => vi.clearAllMocks());

describe("MemoryStore database SSL", () => {
  it.each([undefined, false, true])("uses ssl=%s without changing other connection settings", async (ssl) => {
    const store = new MemoryStore({
      databaseUrl: "postgresql://ccai:p%40ss@postgres:5432/ccai?application_name=ccai&connect_timeout=7",
      ssl,
    });
    const pool = vi.mocked(pg.Pool).mock.results[0]!.value as pg.Pool;
    const client = new pg.Client(pool.options);

    try {
      expect(client.ssl).toEqual(ssl ? { rejectUnauthorized: false } : false);
      expect(client.user).toBe("ccai");
      expect(client.password).toBe("p@ss");
      expect(client.host).toBe("postgres");
      expect(client.database).toBe("ccai");
      expect(new URL(pool.options.connectionString!).searchParams.get("application_name")).toBe("ccai");
      expect(new URL(pool.options.connectionString!).searchParams.get("connect_timeout")).toBe("7");
    } finally {
      await store.close();
    }
  });

  it.each([false, true])("makes ssl=%s authoritative over connection URL SSL parameters", async (ssl) => {
    const store = new MemoryStore({
      databaseUrl: "postgresql://ccai:password@postgres/ccai?sslmode=require&ssl=true&sslcert=missing&sslkey=missing&sslrootcert=missing&application_name=ccai",
      ssl,
    });
    const pool = vi.mocked(pg.Pool).mock.results[0]!.value as pg.Pool;

    try {
      expect(new pg.Client(pool.options).ssl).toEqual(ssl ? { rejectUnauthorized: false } : false);
      expect(new URL(pool.options.connectionString!).search).toBe("?application_name=ccai");
    } finally {
      await store.close();
    }
  });
});
