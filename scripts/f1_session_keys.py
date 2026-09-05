"""三条 sync 管线共用的 session_key 与天气条件映射。

session_key 必须与 race-results-repository.ts 的 buildSessions defs 严格一致，
否则回填的行匹配不到任何 session，页面上什么都不会变——这种错静默且难查，
所以单点定义，不在各脚本里各写一份。
"""

# 键：FastF1 调度表里的 Session 名；值：站点 session_key。
# 2021-22 sprint 周末的冲刺赛在 FastF1 schedule 里统一叫 'Sprint'，
# 'Sprint Shootout' 是 2023 起的名称。
SESSION_KEYS: dict[str, str] = {
    "Practice 1": "practice-1",
    "Practice 2": "practice-2",
    "Practice 3": "practice-3",
    "Qualifying": "qualifying",
    "Sprint Shootout": "sprint-qualifying",
    "Sprint": "sprint",
    "Race": "race",
}


def session_key(name: str) -> str | None:
    """FastF1 的 session 名 → 站点 session_key，不认识的返回 None。"""
    return SESSION_KEYS.get(name)


# WMO weather code → 语义词。weather_code 列存语义词而不是数字：
# 前端按关键词分图标，两个来源（Open-Meteo 数字、trackside 布尔雨量）
# 都要落到同一套词上，否则图标只会永远显示默认值。
def wmo_condition(code: int | None) -> str | None:
    """Open-Meteo 的 WMO code → 语义词（clear/cloud/fog/rain/snow/thunder）。"""
    if code is None:
        return None
    if code == 0:
        return "clear"
    if code in (1, 2, 3):
        return "cloud"
    if code in (45, 48):
        return "fog"
    if code in (71, 73, 75, 77, 85, 86):
        return "snow"
    if code in (95, 96, 99):
        return "thunder"
    if 51 <= code <= 82:
        return "rain"
    return None
