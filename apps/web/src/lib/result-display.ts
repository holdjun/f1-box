// 赛季矩阵格子的展示判定：车队页与车手页共用。

// 名次非数字时（DSQ/EX）直接显示原文，不加 P 前缀
export function formatPosition(position: string | null): string {
  if (position === null) return "—";
  return /^\d+$/.test(position) ? `P${position}` : position;
}

export function resultClass(text: string): string {
  if (text === "1") return "result-win";
  if (text === "2" || text === "3") return "result-podium";
  if (/^\d+$/.test(text)) {
    return Number(text) <= 10 ? "result-points" : "result-finish";
  }
  if (text === "DNF") return "result-ret";
  if (text === "DSQ") return "result-dsq";
  if (text === "DNQ" || text === "DNPQ") return "result-dnq";
  return "result-other";
}
