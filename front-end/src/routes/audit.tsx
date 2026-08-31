import { createFileRoute } from "@tanstack/react-router";
import { ScrollText, Search, FileOutput, ThumbsUp, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

import { TopBar } from "@/components/haca/top-bar";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getAuditLogs, type AuditEntry } from "@/lib/audit-log";

export const Route = createFileRoute("/audit")({
  head: () => ({
    meta: [
      { title: "Audit Logs · HACA Partners — Projet 45" },
    ],
  }),
  component: AuditLogs,
});

const iconMap = {
  search: Search,
  generate: FileOutput,
  validate_source: ThumbsUp,
  regwatch_ack: ShieldCheck,
};

const tagMap: Record<AuditEntry["action"], string> = {
  search: "Query",
  generate: "Deliverable",
  validate_source: "Feedback",
  regwatch_ack: "Pipeline",
};

function AuditLogs() {
  const [logs, setLogs] = useState<AuditEntry[]>([]);

  useEffect(() => {
    setLogs(getAuditLogs());
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <TopBar />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-accent text-accent-foreground">
            <ScrollText className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Audit Logs</h1>
            <p className="text-sm text-muted-foreground">
              {logs.length} actions tracées
            </p>
          </div>
        </div>

        {logs.length === 0 ? (
          <div className="mt-8 text-center text-muted-foreground">
            <p>Aucune action enregistrée pour le moment.</p>
            <p className="mt-1 text-sm">Posez une question dans le Knowledge Assistant pour commencer.</p>
          </div>
        ) : (
          <Card className="mt-6 divide-y divide-border p-0 shadow-fluent-sm">
            {logs.map((log) => {
              const Icon = iconMap[log.action] || Search;
              return (
                <div key={log.id} className="flex items-start gap-3 px-5 py-4">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-secondary text-muted-foreground">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground">
                      <span className="font-semibold">{log.user}</span>{" "}
                      <span className="text-muted-foreground">{log.action}</span>{" "}
                      {log.detail}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {new Date(log.timestamp).toLocaleString("fr-FR")}
                    </p>
                  </div>
                  <Badge variant="secondary" className="shrink-0 text-[11px]">
                    {log.tag || tagMap[log.action]}
                  </Badge>
                </div>
              );
            })}
          </Card>
        )}
      </main>
    </div>
  );
}