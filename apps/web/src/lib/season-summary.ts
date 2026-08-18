// 把年份集合压缩为区间摘要：1990–2000, 2007；空集为 "All seasons"
export function summarizeYears(years: Iterable<number>): string {
  const sorted = [...years].sort((a, b) => a - b);
  if (sorted.length === 0) return "All seasons";
  const ranges: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === prev + 1) {
      prev = sorted[i];
    } else {
      ranges.push(start === prev ? `${start}` : `${start}–${prev}`);
      start = sorted[i];
      prev = sorted[i];
    }
  }
  ranges.push(start === prev ? `${start}` : `${start}–${prev}`);
  return ranges.join(", ");
}
