import { asNumber, asRecord, asString } from "./db-parse.js";
import { mapSeasonYearRows, seasonYearsSql } from "./season-years.js";

export interface CircuitSummary {
  id: string;
  name: string;
  placeName: string;
  countryName: string;
  alpha2Code: string | null;
  length: number;
  turns: number;
  totalRacesHeld: number;
  // 最近一场比赛的布局，决定轮廓 SVG；从未办赛的赛道为 null
  layoutId: string | null;
}

export interface CircuitRecordLap {
  time: string;
  driverName: string;
  year: number;
}

export interface CircuitPage extends CircuitSummary {
  fullName: string;
  direction: string;
  firstGrandPrix: number | null;
  // 最近一场比赛的圈数与距离；从未办赛为 null
  laps: number | null;
  distance: number | null;
  recordLap: CircuitRecordLap | null;
}

// DEV fixture 为页面数据的超集：目录取子集、年份视图按 years 过滤、详情直接返回
interface CircuitFixture extends CircuitPage {
  years: number[];
}

export interface CircuitRepository {
  getCircuits(): Promise<CircuitSummary[]>;
  getCircuitsByYear(year: number): Promise<CircuitSummary[]>;
  getSeasonYears(): Promise<number[]>;
  getCircuit(id: string): Promise<CircuitPage | null>;
}

export interface CircuitDatabase {
  batch(
    statements: { sql: string; values: readonly unknown[] }[],
  ): Promise<{ results: unknown[] }[]>;
}

export function createD1CircuitDatabase(d1: D1Database): CircuitDatabase {
  return {
    batch: (statements) =>
      d1.batch(
        statements.map((statement) =>
          d1.prepare(statement.sql).bind(...statement.values),
        ),
      ),
  };
}

// 布局与页面数据同口径：取最近一场比赛的 layout；按办赛次数降序与目录卡信息量一致
const circuitSelect = `
SELECT c.id, c.name, c.full_name, c.place_name, co.name AS country_name,
  co.alpha2_code, c.direction, c.length, c.turns, c.total_races_held,
  lr.circuit_layout_id AS layout_id`;

const circuitFrom = `
FROM circuit c
LEFT JOIN country co ON co.id = c.country_id
LEFT JOIN race lr ON lr.id = (
  SELECT ra.id FROM race ra WHERE ra.circuit_id = c.id
  ORDER BY ra.year DESC, ra.round DESC LIMIT 1
)`;

const circuitsSql = `${circuitSelect} ${circuitFrom}
ORDER BY c.total_races_held DESC, c.name`;

const circuitsByYearSql = `${circuitSelect} ${circuitFrom}
WHERE c.id IN (SELECT ra.circuit_id FROM race ra WHERE ra.year = ?1)
ORDER BY c.total_races_held DESC, c.name`;

// length/laps/distance 取最近一场比赛的布局口径，与 layout_id 一致；
// first_gp 为历史首办年
const circuitSql = `
SELECT c.id, c.name, c.full_name, c.place_name, co.name AS country_name,
  co.alpha2_code, c.direction, c.turns, c.total_races_held,
  (SELECT MIN(ra.year) FROM race ra WHERE ra.circuit_id = c.id) AS first_gp,
  lr.course_length AS length, lr.laps, lr.distance,
  lr.circuit_layout_id AS layout_id
${circuitFrom}
WHERE c.id = ?1`;

// 历史最快圈：逐站最快圈里取全局最小 millis
const recordLapSql = `
SELECT fl.time, d.name AS driver_name, ra.year
FROM race ra
JOIN fastest_lap fl ON fl.race_id = ra.id
JOIN driver d ON d.id = fl.driver_id
WHERE ra.circuit_id = ?1 AND fl.time_millis IS NOT NULL
ORDER BY fl.time_millis
LIMIT 1`;

export function createCircuitRepository(
  db?: CircuitDatabase,
): CircuitRepository {
  return {
    async getCircuits() {
      if (!db) {
        const fixture = await loadFixture();
        return fixture.map(toSummary);
      }

      const [rows] = await db.batch([{ sql: circuitsSql, values: [] }]);
      return rows.results.map(mapSummaryRow);
    },

    async getCircuitsByYear(year) {
      if (!db) {
        const fixture = await loadFixture();
        return fixture
          .filter((circuit) => circuit.years.includes(year))
          .map(toSummary);
      }

      const [rows] = await db.batch([
        { sql: circuitsByYearSql, values: [year] },
      ]);
      return rows.results.map(mapSummaryRow);
    },

    async getSeasonYears() {
      if (!db) {
        const fixture = await loadFixture();
        return [...new Set(fixture.flatMap((circuit) => circuit.years))].sort(
          (a, b) => b - a,
        );
      }

      const [rows] = await db.batch([{ sql: seasonYearsSql, values: [] }]);
      return mapSeasonYearRows(rows.results);
    },

    async getCircuit(id) {
      if (!db) {
        const fixture = await loadFixture();
        return fixture.find((circuit) => circuit.id === id) ?? null;
      }

      const [circuitRows, recordLapRows] = await db.batch([
        { sql: circuitSql, values: [id] },
        { sql: recordLapSql, values: [id] },
      ]);
      if (circuitRows.results.length === 0) return null;

      const record = asRecord(circuitRows.results[0], "circuit row");
      return {
        ...mapSummaryRow(record),
        fullName: asString(record.full_name, "circuit full name"),
        direction: titleCase(asString(record.direction, "circuit direction")),
        firstGrandPrix:
          record.first_gp == null
            ? null
            : asNumber(record.first_gp, "circuit first gp"),
        laps:
          record.laps == null ? null : asNumber(record.laps, "circuit laps"),
        distance:
          record.distance == null
            ? null
            : asNumber(record.distance, "circuit distance"),
        recordLap:
          recordLapRows.results.length === 0
            ? null
            : mapRecordLapRow(recordLapRows.results[0]),
      };
    },
  };
}

async function loadFixture(): Promise<CircuitFixture[]> {
  // fixture 仅 DEV 用，动态导入避免打进生产 bundle
  const { default: fixture } = await import("./fixtures/circuits.json");
  return fixture as CircuitFixture[];
}

function toSummary(circuit: CircuitFixture): CircuitSummary {
  return {
    id: circuit.id,
    name: circuit.name,
    placeName: circuit.placeName,
    countryName: circuit.countryName,
    alpha2Code: circuit.alpha2Code,
    length: circuit.length,
    turns: circuit.turns,
    totalRacesHeld: circuit.totalRacesHeld,
    layoutId: circuit.layoutId,
  };
}

function mapSummaryRow(value: unknown): CircuitSummary {
  const record = asRecord(value, "circuit row");
  return {
    id: asString(record.id, "circuit id"),
    name: asString(record.name, "circuit name"),
    placeName: asString(record.place_name, "circuit place"),
    countryName: asString(record.country_name, "circuit country"),
    alpha2Code:
      record.alpha2_code == null
        ? null
        : asString(record.alpha2_code, "circuit flag code").toLowerCase(),
    length: asNumber(record.length, "circuit length"),
    turns: asNumber(record.turns, "circuit turns"),
    totalRacesHeld: asNumber(record.total_races_held, "circuit races held"),
    layoutId:
      record.layout_id == null
        ? null
        : asString(record.layout_id, "circuit layout"),
  };
}

function mapRecordLapRow(value: unknown): CircuitRecordLap {
  const record = asRecord(value, "record lap row");
  return {
    time: asString(record.time, "record lap time"),
    driverName: asString(record.driver_name, "record lap driver"),
    year: asNumber(record.year, "record lap year"),
  };
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}
