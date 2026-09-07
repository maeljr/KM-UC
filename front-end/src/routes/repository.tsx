import { createFileRoute, Link } from "@tanstack/react-router";
import { Library, FileText, Search, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";

import { TopBar } from "@/components/haca/top-bar";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/repository")({
  head: () => ({
    meta: [
      { title: "Knowledge Repository · HACA Partners — Projet 45" },
      {
        name: "description",
        content:
          "Référentiel documentaire public : circulaires, directives, règlements et lois.",
      },
    ],
  }),
  component: Repository,
});

function classifyTheme(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("aml") || n.includes("blanchiment") || n.includes("ctf") || n.includes("lc-ft") || n.includes("money laundering") || n.includes("terrorist financing")) return "LCB-FT";
  if (n.includes("dora") || n.includes("ict") || n.includes("digital operational") || n.includes("cyber") || n.includes("outsourcing")) return "DORA / ICT";
  if (n.includes("esg") || n.includes("environmental") || n.includes("social") || n.includes("climate") || n.includes("durab")) return "ESG";
  if (n.includes("governance") || n.includes("internal governance") || n.includes("remuneration") || n.includes("fit and proper")) return "Gouvernance";
  if (n.includes("risk management") || n.includes("gestion des risques")) return "Risques";
  if (n.includes("cssf") || n.includes("eba") || n.includes("esma") || n.includes("circular") || n.includes("guideline")) return "Réglementaire";
  if (n.includes("fund") || n.includes("sicav") || n.includes("sicar") || n.includes("raif") || n.includes("ucits") || n.includes("aifm")) return "Fonds";
  if (n.includes("deposit") || n.includes("fgdl") || n.includes("garantie des dépôts")) return "Dépôts garantis";
  return "Autre";
}

type DocumentItem = {
  parentId: string;
  name: string;
  url: string;
  library: string;
  documentType: string;
  businessLine: string;
  primaryTopic: string;
  theme: string;
};

function Repository() {
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    fetchDocuments();
  }, []);

  const fetchDocuments = async () => {
    try {
      const response = await fetch("/api/repository", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!response.ok) throw new Error("Backend injoignable");

      const data = await response.json();
      const seen = new Set<string>();
      const unique: DocumentItem[] = [];

      for (const item of data.value || []) {
        const key = `${item.library || ""}|${item.name || ""}`;
        const type = (item.documentType || "").toLowerCase();
        const isPublic = true;

        if (isPublic && !seen.has(key)) {
          seen.add(key);
          unique.push({
            parentId: item.parentId,
            name: item.name || "Sans titre",
            url: item.url || "",
            library: item.library || "—",
            documentType: item.documentType || "—",
            businessLine: item.businessLine || "—",
            primaryTopic: item.primaryTopic || "—",
            theme: classifyTheme(item.name || "") !== "Autre"
              ? classifyTheme(item.name || "")
              : classifyTheme(item.primaryTopic || ""),
          });
        }
      }

      setDocuments(unique);
    } catch (error) {
      console.error("Erreur chargement repository:", error);
      setDocuments([]);
    } finally {
      setLoading(false);
    }
  };

  const filtered = documents.filter((d) =>
    d.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    d.businessLine.toLowerCase().includes(searchTerm.toLowerCase()) ||
    d.primaryTopic.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const themes = Array.from(new Set(filtered.map((d) => d.theme)));

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
              {loading ? "Chargement…" : `${documents.length} documents publics indexés`}
            </p>
          </div>
        </div>

        <div className="mt-6 flex items-center gap-2 rounded-xl border border-input bg-card p-2 shadow-fluent-sm">
          <Search className="ml-2 h-5 w-5 shrink-0 text-muted-foreground" />
          <Input
            placeholder="Rechercher un document, une business line, un topic…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="border-0 bg-transparent px-1 py-1.5 text-sm shadow-none focus-visible:ring-0"
          />
        </div>

        {loading ? (
          <div className="mt-12 text-center text-muted-foreground">
            <p>Chargement des documents…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="mt-12 text-center text-muted-foreground">
            <p>Aucun document trouvé.</p>
          </div>
        ) : (
          <div className="mt-6 space-y-10">
            {themes.map((theme) => (
              <section key={theme}>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  {theme}
                </h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {filtered
                    .filter((d) => d.theme === theme)
                    .map((doc) => (
                      <Card key={doc.parentId} className="flex flex-col p-5 shadow-fluent-sm transition-shadow hover:shadow-fluent">
                        <div className="flex items-start justify-between gap-2">
                          <Badge variant="outline" className="text-[10px] font-semibold text-primary">
                            {doc.library}
                          </Badge>
                          {doc.url && (
                            <a href={doc.url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground">
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          )}
                        </div>
                        <p className="mt-3 flex items-start gap-2 text-sm font-semibold leading-snug text-foreground">
                          <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                          {doc.name}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          <Badge variant="secondary" className="text-[10px]">{doc.documentType}</Badge>
                          {doc.businessLine !== "—" && (
                            <Badge variant="secondary" className="text-[10px]">{doc.businessLine}</Badge>
                          )}
                          {doc.primaryTopic !== "—" && (
                            <Badge variant="outline" className="text-[10px]">{doc.primaryTopic}</Badge>
                          )}
                        </div>
                      </Card>
                    ))}
                </div>
              </section>
            ))}
          </div>
        )}

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