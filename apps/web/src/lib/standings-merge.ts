// 车队积分榜合并规则：1960 年代同一车队按引擎供应商分成多行——积分累加、
// 名次取最好、任一夺冠即夺冠。车队页与 AI 问答共用，口径单一出处
interface StandingSlice {
  points: number;
  positionText: string;
  championshipWon: boolean;
}

export interface StandingTotal {
  points: number;
  positionText: string | null;
  championshipWon: boolean;
}

export function mergeStanding(
  total: StandingTotal | undefined,
  slice: StandingSlice,
): StandingTotal {
  if (total === undefined) {
    return {
      points: slice.points,
      positionText: slice.positionText,
      championshipWon: slice.championshipWon,
    };
  }
  return {
    points: total.points + slice.points,
    positionText: betterPositionText(total.positionText, slice.positionText),
    championshipWon: total.championshipWon || slice.championshipWon,
  };
}

// 仅数字名次参与比较且越小越好；NC、EX 等非数字标签不顶替已有名次，只在尚无名次时收录
function betterPositionText(
  current: string | null,
  candidate: string,
): string | null {
  if (current === null) return candidate;
  const candidateNumber = Number(candidate);
  if (!Number.isInteger(candidateNumber)) return current;
  const currentNumber = Number(current);
  if (!Number.isInteger(currentNumber) || candidateNumber < currentNumber) {
    return candidate;
  }
  return current;
}
