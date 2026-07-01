import { createFileRoute } from "@tanstack/react-router";
import { ScrollText, Search, FileOutput, ThumbsUp, ShieldCheck } from "lucide-react";

import { TopBar } from "@/components/haca/top-bar";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/audit")({
  head: () => ({
    meta: [
      { title: "Audit Logs · HACA Partners — Projet 45" },
      {
        name: "description",
        content:
          "Journal d'audit traçable : requêtes, génération de livrables et validations des sources pour la conformité.",
      },
      { property: "og:title", content: "Audit Logs · HACA Partners" },
      {
        property: "og:description",
        content: "Traçabilité complète des interactions du Knowledge Assistant et du RegWatch Agent.",
      },
    ],
  }),
  component: AuditLogs,
});

const logs = [
  { icon: Search, user: "Camille Rousseau", action: "Searched", detail: "ICT governance requirements (CSSF / EBA)", time: "09:42", tag: "Query" },
  { icon: FileOutput, user: "Camille Rousseau", action: "Generated", detail: "Deliverable AUD-LU-12 (PDF export)", time: "09:38", tag: "Deliverable" },
  { icon: ThumbsUp, user: "Léa Bertrand", action: "Validated source", detail: "EBA/GL/2019/02 marked relevant", time: "09:15", tag: "Feedback" },
  { icon: ShieldCheck, user: "RegWatch Agent", action: "Approved", detail: "CRD VI alert escalated to Moderator", time: "08:51", tag: "Pipeline" },
  { icon: Search, user: "Léa Bertrand", action: "Searched", detail: "Cloud exit strategy expectations", time: "08:30", tag: "Query" },
];

function AuditLogs() {
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
            <p className="text-sm text-muted-foreground">Traçabilité des actions · aujourd'hui</p>
          </div>
        </div>

        <Card className="mt-6 divide-y divide-border p-0 shadow-fluent-sm">
          {logs.map((log, i) => (
            <div key={i} className="flex items-start gap-3 px-5 py-4">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-secondary text-muted-foreground">
                <log.icon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-foreground">
                  <span className="font-semibold">{log.user}</span>{" "}
                  <span className="text-muted-foreground">{log.action.toLowerCase()}</span>{" "}
                  {log.detail}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">{log.time}</p>
              </div>
              <Badge variant="secondary" className="shrink-0 text-[11px]">
                {log.tag}
              </Badge>
            </div>
          ))}
        </Card>
      </main>
    </div>
  );
}
