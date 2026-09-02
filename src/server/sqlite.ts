// SQLite 封装：基于 Node 22 内置 node:sqlite（零原生依赖）
// 兼容 better-sqlite3 的 prepare/run/get/all/transaction 接口
import { DatabaseSync } from 'node:sqlite'

type SqlValue = string | number | bigint | null | Uint8Array
type BindParams = Record<string, SqlValue> | SqlValue[]

interface RunResult {
  changes: number
  lastInsertRowid: number | bigint
}

export interface Statement {
  run(...params: unknown[]): RunResult
  run(params: BindParams): RunResult
  get(...params: unknown[]): unknown
  get(params: BindParams): unknown
  all(...params: unknown[]): unknown[]
  all(params: BindParams): unknown[]
}

function normalizeParams(params: unknown[]): SqlValue[] {
  return params.map(p => (p === undefined ? null : p as SqlValue))
}

function normalizeObjParams(params: Record<string, unknown>): Record<string, SqlValue> {
  const out: Record<string, SqlValue> = {}
  for (const [k, v] of Object.entries(params)) out[k] = v === undefined ? null : v as SqlValue
  return out
}

export class SqliteDB {
  private db: DatabaseSync

  constructor(filename: string) {
    this.db = new DatabaseSync(filename)
  }

  pragma(sql: string): void {
    this.db.exec(`PRAGMA ${sql}`)
  }

  exec(sql: string): void {
    this.db.exec(sql)
  }

  prepare(sql: string): Statement {
    const stmt = this.db.prepare(sql)
    return {
      run(...params: unknown[]): RunResult {
        if (params.length === 1 && typeof params[0] === 'object' && params[0] !== null && !Array.isArray(params[0])) {
          const r = stmt.run(normalizeObjParams(params[0] as Record<string, unknown>))
          return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) }
        }
        const args = normalizeParams(params)
        const r = stmt.run(...(args as [never]))
        return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) }
      },
      get(...params: unknown[]): unknown {
        if (params.length === 1 && typeof params[0] === 'object' && params[0] !== null && !Array.isArray(params[0])) {
          return stmt.get(normalizeObjParams(params[0] as Record<string, unknown>))
        }
        const args = normalizeParams(params)
        return stmt.get(...(args as [never]))
      },
      all(...params: unknown[]): unknown[] {
        if (params.length === 1 && typeof params[0] === 'object' && params[0] !== null && !Array.isArray(params[0])) {
          return stmt.all(normalizeObjParams(params[0] as Record<string, unknown>))
        }
        const args = normalizeParams(params)
        return stmt.all(...(args as [never]))
      },
    }
  }

  transaction<T extends (...args: never[]) => unknown>(fn: T): T {
    return ((...args: never[]) => {
      this.db.exec('BEGIN')
      try {
        const result = fn(...args)
        this.db.exec('COMMIT')
        return result
      } catch (e) {
        this.db.exec('ROLLBACK')
        throw e
      }
    }) as T
  }

  close(): void {
    this.db.close()
  }
}

export type { DatabaseSync }
