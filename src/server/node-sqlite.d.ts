// node:sqlite 类型声明（Node 22 内置，experimental）
declare module 'node:sqlite' {
  export interface StatementSync {
    run(...params: (string | number | bigint | null | Uint8Array)[]): { changes: number | bigint; lastInsertRowid: number | bigint }
    run(params: Record<string, string | number | bigint | null | Uint8Array>): { changes: number | bigint; lastInsertRowid: number | bigint }
    get(...params: (string | number | bigint | null | Uint8Array)[]): Record<string, unknown> | undefined
    get(params: Record<string, string | number | bigint | null | Uint8Array>): Record<string, unknown> | undefined
    all(...params: (string | number | bigint | null | Uint8Array)[]): Record<string, unknown>[]
    all(params: Record<string, string | number | bigint | null | Uint8Array>): Record<string, unknown>[]
  }

  export class DatabaseSync {
    constructor(filename: string)
    exec(sql: string): void
    prepare(sql: string): StatementSync
    close(): void
  }
}
