export type Suggestion = {
  text: string;
  count: number;
};

const STORAGE_KEY = "haca-question-history";

function getHistory(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveHistory(history: Record<string, number>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
}

export function recordQuestion(text: string) {
  const normalized = text.trim();
  if (!normalized) return;
  const history = getHistory();
  history[normalized] = (history[normalized] || 0) + 1;
  saveHistory(history);
}

export function getSuggestions(prefix: string, limit = 5): Suggestion[] {
  const prefixLower = prefix.toLowerCase().trim();
  const history = getHistory();
  if (!prefixLower) return [];

  return Object.entries(history)
    .filter(([question]) => question.toLowerCase().startsWith(prefixLower))
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([text, count]) => ({ text, count }));
}