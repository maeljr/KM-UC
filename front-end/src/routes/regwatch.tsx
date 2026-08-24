import React, { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CircleAlert,
  Clock,
  ExternalLink,
  Filter,
  Microscope,
  ShieldCheck,
  Timer,
} from "lucide-react";

import { TopBar } from "@/components/haca/top-bar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/regwatch")({
  head: () => ({
    meta: [
      { title: "RegWatch Agent · HACA Partners — Projet 45" },
      {
        name: "description",
        content:
          "Surveillance réglementaire automatisée : alertes CRD VI, EBA Guidelines et contrôles d'obsolescence avec pipeline de validation MVP.",
      },
      { property: "og:title", content: "RegWatch Agent · HACA Partners" },
      {
        property: "og:description",
        content:
          "Daily Scan → LLM Analysis → Moderator Approval. Alertes de conformité priorisées pour les auditeurs.",
      },
    ],
  }),
  component: RegWatchAgent,
});

type Severity = "action" | "alert" | "info";

type Alert = {
  id: string;
  category: string;
  severity: Severity;
  title: string;
  summary: string;
  date: string;
  link: string;
  source: string;
};

const severityStyles: Record<
  Severity,
  { dot: string; label: string; badge: string }
> = {
  action: {
    dot: "bg-destructive",
    label: "Action Required",
    badge: "border-destructive/30 bg-destructive/10 text-destructive",
  },
  alert: {
    dot: "bg-warning",
    label: "Alert",
    badge: "border-warning/40 bg-warning/15 text-warning-foreground",
  },
  info: {
    dot: "bg-primary",
    label: "Info",
    badge: "border-primary/30 bg-accent text-accent-foreground",
  },
};

const pipeline = [
  { label: "Daily Scan", icon: Timer, state: "done" as const },
  { label: "LLM Analysis", icon: Microscope, state: "active" as const },
  { label: "Moderator Approval", icon: ShieldCheck, state: "pending" as const },
];

function RegWatchAgent() {
  const [actionOnly, setActionOnly] = useState(false);
  const [acknowledged, setAcknowledged] = useState<Record<string, boolean>>({});
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);

  React.useEffect(() => {
    fetch("/data/regwatch.json")
      .then((res) => res.json())
      .then((data: any[]) => {
        const mapped: Alert[] = data.map((item, index) => ({
          id: `reg-${index}`,
          category: item.source || "RegWatch",
          severity: "info",
          title: item.title?.split("\n")[0] || "Alerte",
          summary: item.title?.slice(0, 300) || "",
          date: item.date || "",
          link: item.link || "#",
          source: item.source || "",
        }));
        setAlerts(mapped);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // Catégories dynamiques basées sur les alertes chargées
  const categories = React.useMemo(() => {
    const counts: Record<string, number> = {};
    alerts.forEach((alert) => {
      const key = alert.source || alert.category || "Autre";
      counts[key] = (counts[key] || 0) + 1;
    });
    return Object.entries(counts).map(([label, count]) => ({
      id: label.toLowerCase().replace(/\s+/g, "-"),
      label,
      severity: "info" as Severity,
      count,
    }));
  }, [alerts]);

  const actionRequired = alerts.filter((a) => a.severity === "action").length;
  const totalAlerts = alerts.length;

  const visible = actionOnly ? alerts.filter((a) => a.severity === "action") : alerts;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TopBar />

      <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col px-4 py-6 sm:px-6 lg:flex-row lg:gap-6">
        {/* Left sidebar filters */}
        <aside className="w-full shrink-0 lg:w-[280px]">
          <Card className="border-border p-4 shadow-fluent-sm lg:sticky lg:top-[88px]">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold text-foreground">Compliance Tasks</h2>
            </div>

            <label className="mt-4 flex cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-secondary/50 px-3 py-2.5 transition-colors hover:bg-secondary">
              <button
                type="button"
                role="checkbox"
                aria-checked={actionOnly}
                onClick={() => setActionOnly((v) => !v)}
                className={cn(
                  "grid h-4 w-4 shrink-0 place-items-center rounded border transition-colors",
                  actionOnly
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input bg-card",
                )}
              >
                {actionOnly && <Check className="h-3 w-3" />}
              </button>
              <span className="text-[13px] font-medium text-foreground">
                Show Action Required Only
              </span>
            </label>

            <p className="mt-5 mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Alert Categories
            </p>
            <ul className="space-y-1">
              {categories.map((cat) => (
                <li key={cat.id}>
                  <button className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-secondary">
                    <span
                      className={cn(
                        "h-2 w-2 shrink-0 rounded-full",
                        severityStyles[cat.severity].dot,
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
                      {cat.label}
                    </span>
                    <Badge variant="secondary" className="h-5 px-1.5 text-[11px]">
                      {cat.count}
                    </Badge>
                  </button>
                </li>
              ))}
            </ul>

            <div className="mt-5 rounded-lg border border-border bg-secondary/40 p-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                <CircleAlert className="h-3.5 w-3.5 text-destructive" />
                Priority Summary
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                <span className="font-semibold text-destructive">{actionRequired} items</span> require action ·{" "}
                <span className="font-semibold text-warning-foreground">{totalAlerts} alerts</span> under review.
              </p>
            </div>
          </Card>
        </aside>

        {/* Main content */}
        <main className="min-w-0 flex-1 pb-28">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                RegWatch: Selection of the Day
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Alertes réglementaires priorisées par l'agent · {visible.length} affichées
              </p>
            </div>
            <Badge variant="outline" className="gap-1.5 border-success/40 text-success">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
              Live monitoring
            </Badge>
          </div>

          {loading && (
            <div className="mt-5 rounded-lg border border-border bg-secondary/40 p-4 text-sm text-muted-foreground">
              Chargement des alertes RegWatch…
            </div>
          )}

          <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
            {visible.map((alert) => {
              const sev = severityStyles[alert.severity];
              const isAck = acknowledged[alert.id];
              return (
                <Card
                  key={alert.id}
                  className="flex flex-col border-border p-5 shadow-fluent-sm transition-shadow hover:shadow-fluent"
                >
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="outline" className={cn("gap-1.5", sev.badge)}>
                      <span className={cn("h-1.5 w-1.5 rounded-full", sev.dot)} />
                      {sev.label}
                    </Badge>
                    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {alert.date}
                    </span>
                  </div>

                  <Badge variant="secondary" className="mt-3 w-fit text-[11px]">
                    {alert.category}
                  </Badge>
                  <h3 className="mt-2 text-[15px] font-semibold leading-snug text-foreground">
                    {alert.title}
                  </h3>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">
                    {alert.summary}
                  </p>

                  <a
                    href={alert.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-flex w-fit items-center gap-1.5 text-xs font-medium text-primary transition-colors hover:text-primary-hover hover:underline"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Voir la source
                  </a>

                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
                    <Button
                      variant={isAck ? "secondary" : "outline"}
                      size="sm"
                      className="gap-1.5"
                      onClick={() =>
                        setAcknowledged((p) => ({ ...p, [alert.id]: !p[alert.id] }))
                      }
                    >
                      <Check className="h-3.5 w-3.5" />
                      {isAck ? "Acknowledged" : "Acknowledge"}
                    </Button>
                    <Button size="sm" className="gap-1.5">
                      <Microscope className="h-3.5 w-3.5" />
                      Voir plus
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        </main>
      </div>

      {/* Bottom progress bar — MVP Validation Pipeline */}
      <div className="sticky bottom-0 z-30 border-t border-border bg-card/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-2 shrink-0">
            <AlertTriangle className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">MVP Validation Pipeline</span>
          </div>

          <div className="flex flex-1 items-center justify-start gap-1 overflow-x-auto sm:justify-center">
            {pipeline.map((step, i) => (
              <div key={step.label} className="flex shrink-0 items-center gap-1">
                <div
                  className={cn(
                    "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    step.state === "done" &&
                      "border-success/40 bg-success/15 text-success",
                    step.state === "active" &&
                      "border-primary/40 bg-accent text-accent-foreground",
                    step.state === "pending" &&
                      "border-border bg-secondary text-muted-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "grid h-5 w-5 place-items-center rounded-full",
                      step.state === "done" && "bg-success text-success-foreground",
                      step.state === "active" && "bg-primary text-primary-foreground",
                      step.state === "pending" && "bg-muted-foreground/20 text-muted-foreground",
                    )}
                  >
                    {step.state === "done" ? (
                      <Check className="h-3 w-3" />
                    ) : (
                      <step.icon className="h-3 w-3" />
                    )}
                  </span>
                  {step.label}
                </div>
                {i < pipeline.length - 1 && (
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
              </div>
            ))}
          </div>

          <div className="hidden shrink-0 items-center gap-2 text-[11px] text-muted-foreground sm:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            Stage 2 of 3 in progress
          </div>
        </div>
      </div>
    </div>
  );
}