"""同步管线共用的 session 键与比赛日期匹配。

session_key 必须与 race-results-repository.ts 的 buildSessions defs 严格一致，
否则回填的行匹配不到任何 session，页面上什么都不会变——这种错静默且难查，
所以单点定义，不在各脚本里各写一份。
"""

# 键：FastF1 调度表里的 Session 名；值：站点 session_key。
# 2021-22 sprint 周末的冲刺赛在 FastF1 schedule 里统一叫 'Sprint'；
# 冲刺排位在 2023 叫 Sprint Shootout，2024 起改叫 Sprint Qualifying。
SESSION_KEYS: dict[str, str] = {
    "Practice 1": "practice-1",
    "Practice 2": "practice-2",
    "Practice 3": "practice-3",
    "Qualifying": "qualifying",
    "Sprint Shootout": "sprint-qualifying",
    "Sprint Qualifying": "sprint-qualifying",
    "Sprint": "sprint",
    "Race": "race",
}


def session_key(name: str) -> str | None:
    """FastF1 的 session 名 → 站点 session_key，不认识的返回 None。"""
    return SESSION_KEYS.get(name)


def matches_race_date(event, expected: str) -> bool:
    # 夜赛的赛地日期可能比 f1db 的 UTC 比赛日早一天（如拉斯维加斯）。
    dates = {str(event.get("EventDate"))[:10]}
    for index in range(1, 6):
        if event.get(f"Session{index}") == "Race":
            dates.add(str(event.get(f"Session{index}DateUtc"))[:10])
    return expected in dates
