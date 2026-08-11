export interface DriverSummary {
  id: string;
  name: string;
  number: string | null;
  flagCode: string | null;
  teamId: string | null;
  teamName: string | null;
  isCurrent: boolean;
}

export interface DriverRepository {
  getDrivers(): Promise<DriverSummary[]>;
}

export interface DriverDatabase {
  batch(
    statements: { sql: string; values: readonly unknown[] }[],
  ): Promise<{ results: unknown[] }[]>;
}

// D1 batch 需要预编译语句，仓库层接口用 {sql, values} 以便测试替身
export function createD1DriverDatabase(d1: D1Database): DriverDatabase {
  return {
    batch: (statements) =>
      d1.batch(
        statements.map((statement) =>
          d1.prepare(statement.sql).bind(...statement.values),
        ),
      ),
  };
}

// 最后赛季多车队时取整行（constructor_id 与 team_name 同行，避免颜色错配）；
// 当前赛季车手优先，其余按生涯成就排序，与车队目录同一哲学
const driversSql = `
WITH latest_season AS (
  SELECT MAX(year) AS year FROM season
),
current_drivers AS (
  SELECT DISTINCT driver_id
  FROM season_entrant_driver
  WHERE year = (SELECT year FROM latest_season) AND test_driver = 0
),
last_team AS (
  SELECT driver_id, constructor_id, team_name
  FROM (
    SELECT sed.driver_id, sed.constructor_id, c.name AS team_name,
      ROW_NUMBER() OVER (
        PARTITION BY sed.driver_id ORDER BY sed.year DESC, c.name
      ) AS rn
    FROM season_entrant_driver sed
    JOIN constructor c ON c.id = sed.constructor_id
    WHERE sed.test_driver = 0
  )
  WHERE rn = 1
)
SELECT d.id, d.name, d.permanent_number, co.alpha2_code,
  lt.constructor_id AS team_id, lt.team_name,
  CASE WHEN cd.driver_id IS NULL THEN 0 ELSE 1 END AS is_current
FROM driver d
LEFT JOIN country co ON co.id = d.nationality_country_id
LEFT JOIN last_team lt ON lt.driver_id = d.id
LEFT JOIN current_drivers cd ON cd.driver_id = d.id
ORDER BY
  CASE WHEN cd.driver_id IS NULL THEN 1 ELSE 0 END,
  d.total_championship_wins DESC,
  d.total_race_wins DESC,
  d.total_race_entries DESC,
  d.name`;

export function createDriverRepository(db?: DriverDatabase): DriverRepository {
  return {
    async getDrivers() {
      if (!db) {
        // fixture 仅 DEV 用，动态导入避免打进生产 bundle
        const { default: fixture } = await import("./fixtures/drivers.json");
        return fixture as DriverSummary[];
      }

      const [rows] = await db.batch([{ sql: driversSql, values: [] }]);
      return rows.results.map((row) => {
        const record = asRecord(row, "driver row");
        return {
          id: asString(record.id, "driver id"),
          name: asString(record.name, "driver name"),
          number:
            record.permanent_number == null
              ? null
              : asString(record.permanent_number, "driver number"),
          // 国旗 SVG 以 alpha2 小写命名
          flagCode:
            record.alpha2_code == null
              ? null
              : asString(record.alpha2_code, "driver flag code").toLowerCase(),
          teamId:
            record.team_id == null
              ? null
              : asString(record.team_id, "driver team id"),
          teamName:
            record.team_name == null
              ? null
              : asString(record.team_name, "driver team name"),
          isCurrent: record.is_current === 1,
        };
      });
    },
  };
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid driver data: expected ${label} to be an object`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`Invalid driver data: expected ${label} to be a string`);
  }
  return value;
}
