-- 站点自己的表：不属于 f1db 上游，不能进 f1db-d1-dump.sh 生成的夹具。
-- f1db 全量重导不会 DROP 这些表；preview 与生产共用同一份 D1。
-- 不建到 f1db 表的外键：00-drop.sql 会 DROP f1db 表，外键会挡住清库。

-- 用 (year, round) 而不是 race.id 关联：id 是上游代理键，补录一场早期比赛
-- 就可能整体平移，旧行会静默指向另一场比赛。(year, round) 是 f1db 的业务唯一键；
-- 写入前仍须核对比赛日期，防止赛历改期或重排导致串场。
CREATE TABLE IF NOT EXISTS session_time (
  year INTEGER NOT NULL,
  round INTEGER NOT NULL,
  session_key TEXT NOT NULL,
  starts_at_utc TEXT NOT NULL,
  source TEXT NOT NULL,
  PRIMARY KEY (year, round, session_key)
);
