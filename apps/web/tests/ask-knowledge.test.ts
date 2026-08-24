import { describe, expect, it } from "vitest";
import {
  type KnowledgeEntry,
  knowledgeEntries,
  matchKnowledge,
} from "../src/lib/ask/knowledge.js";

const entries: KnowledgeEntry[] = [
  {
    id: "undercut",
    terms: ["undercut", "早进站"],
    content: "Undercut 内容",
  },
  {
    id: "overcut",
    terms: ["overcut", "晚进站"],
    content: "Overcut 内容",
  },
  {
    id: "qicheeren",
    terms: ["汽车人"],
    content: "汽车人内容",
  },
];

describe("matchKnowledge", () => {
  it("matches latin terms case-insensitively", () => {
    expect(matchKnowledge("什么是 UnderCut？", entries)).toEqual([entries[0]]);
  });

  it("matches chinese terms by containment", () => {
    expect(matchKnowledge("汽车人是什么梗", entries)).toEqual([entries[2]]);
  });

  it("matches at most 3 entries in file order", () => {
    const many: KnowledgeEntry[] = Array.from({ length: 5 }, (_, i) => ({
      id: `e${i}`,
      terms: [`term${i}`],
      content: `内容${i}`,
    }));
    const query = "term0 term1 term2 term3 term4";
    expect(matchKnowledge(query, many).map((e) => e.id)).toEqual([
      "e0",
      "e1",
      "e2",
    ]);
  });

  it("returns empty when nothing matches", () => {
    expect(matchKnowledge("汉密尔顿几个冠军", entries)).toEqual([]);
  });

  it("seed file has unique ids and non-empty terms/content", () => {
    const ids = new Set(knowledgeEntries.map((e) => e.id));
    expect(ids.size).toBe(knowledgeEntries.length);
    for (const entry of knowledgeEntries) {
      expect(entry.terms.length).toBeGreaterThan(0);
      expect(entry.content.length).toBeGreaterThan(0);
    }
  });
});
