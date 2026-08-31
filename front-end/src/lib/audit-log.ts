// Service de journalisation des actions utilisateur (localStorage pour MVP)

export type AuditEntry = {
  id: string;
  user: string;
  action: "search" | "generate" | "validate_source" | "regwatch_ack";
  detail: string;
  timestamp: string;
  tag: string;
};

const STORAGE_KEY = "haca-audit-logs";

export function addAuditLog(entry: Omit<AuditEntry, "id" | "timestamp">) {
  try {
    const logs = getAuditLogs();
    const newEntry: AuditEntry = {
      ...entry,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      timestamp: new Date().toISOString(),
    };
    logs.unshift(newEntry);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(logs.slice(0, 100)));
  } catch (e) {
    console.error("Erreur d'audit:", e);
  }
}

export function getAuditLogs(): AuditEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function clearAuditLogs() {
  localStorage.removeItem(STORAGE_KEY);
}