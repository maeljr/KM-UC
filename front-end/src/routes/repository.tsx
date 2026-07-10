import { createFileRoute, Link } from "@tanstack/react-router";
import { Library, FileText, Filter, Search } from "lucide-react";

import { TopBar } from "@/components/haca/top-bar";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/repository")({
  head: () => ({
    meta: [
      { title: "Knowledge Repository · HACA Partners — Projet 45" },
      {
        name: "description",
        content:
          "Référentiel documentaire indexé : circulaires CSSF, guidelines EBA et templates d'audit consultables.",
      },
      { property: "og:title", content: "Knowledge Repository · HACA Partners" },
      {
        property: "og:description",
        content: "Sources réglementaires vérifiées et indexées pour le RAG Projet 45.",
      },
    ],
  }),
  component: Repository,
});

const docs = [
  { ref: "CSSF 20/750", title: "ICT and Security Risk Management", type: "Circular", year: "2020" },
  { ref: "EBA/GL/2019/02", title: "Guidelines on Outsourcing Arrangements", type: "Guideline", year: "2019" },
  { ref: "CRD VI", title: "Capital Requirements Directive (EU) 2024/1619", type: "Directive", year: "2024" },
  { ref: "CSSF 22/806", title: "Outsourcing arrangements", type: "Circular", year: "2022" },
  { ref: "EBA/GL/2021/05", title: "Internal Governance", type: "Guideline", year: "2021" },
  { ref: "AUD-LU-12", title: "Audit deliverable template — Luxembourg", type: "Template", year: "2023" },
];

function Repository() {
  return (
    <div className="min-h-screen bg-background">
      <TopBar />
      <main className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-accent text-accent-foreground">
            <Library className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Knowledge Repository
            </h1>
            <p className="text-sm text-muted-foreground">
              {docs.length} sources indexées sur Azure AI Search
            </p>
          </div>
        </div>

        <div className="mt-6 flex items-center gap-2 rounded-xl border border-input bg-card p-2 shadow-fluent-sm focus-within:border-primary">
          <Search className="ml-2 h-5 w-5 text-muted-foreground" />
          <input
            placeholder="Filtrer les documents…"
            className="min-w-0 flex-1 bg-transparent px-1 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
          />
          <Button variant="outline" size="sm" className="gap-1.5">
            <Filter className="h-4 w-4" />
            Filters
          </Button>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {docs.map((d) => (
            <Card key={d.ref} className="p-5 shadow-fluent-sm transition-shadow hover:shadow-fluent">
              <div className="flex items-center justify-between">
                <Badge variant="outline" className="border-primary/30 text-[10px] font-semibold text-primary">
                  {d.ref}
                </Badge>
                <Badge variant="secondary" className="text-[11px]">{d.type}</Badge>
              </div>
              <p className="mt-3 flex items-start gap-2 text-sm font-semibold leading-snug text-foreground">
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                {d.title}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">Effective {d.year}</p>
            </Card>
          ))}
        </div>

        <p className="mt-8 text-center text-sm text-muted-foreground">
          Besoin d'une réponse rapide ?{" "}
          <Link to="/" className="font-medium text-primary hover:underline">
            Ouvrir le Knowledge Assistant
          </Link>
        </p>
      </main>
    </div>
  );
}
