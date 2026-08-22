// 问答查询的最小数据库接口：一条语句一批绑定参数。静态实现供单测与 DEV fixture 共用
export interface AskDatabase {
  run(sql: string, values: readonly unknown[]): Promise<unknown[]>;
}

export function createD1AskDatabase(d1: D1Database): AskDatabase {
  return {
    async run(sql, values) {
      const statement = d1.prepare(sql).bind(...values);
      const outcome = await statement.all();
      return outcome.results;
    },
  };
}

export function createStaticAskDatabase(
  rows: Record<string, unknown[]>,
): AskDatabase {
  return {
    async run(sql) {
      return rows[sql] ?? [];
    },
  };
}
