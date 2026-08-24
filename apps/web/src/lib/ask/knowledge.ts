import rawEntries from "../../data/f1-knowledge.json";

// 中文语境术语/梗的确定性关键词匹配：不引入 embedding（条目多后再评估检索升级）
export interface KnowledgeEntry {
  id: string;
  terms: string[];
  content: string;
}

export const knowledgeEntries = rawEntries as KnowledgeEntry[];

const MAX_INJECT = 3;

export function matchKnowledge(
  query: string,
  entries: KnowledgeEntry[],
): KnowledgeEntry[] {
  const haystack = query.toLowerCase();
  const hits: KnowledgeEntry[] = [];
  for (const entry of entries) {
    if (entry.terms.some((term) => haystack.includes(term.toLowerCase()))) {
      hits.push(entry);
      if (hits.length >= MAX_INJECT) break;
    }
  }
  return hits;
}
