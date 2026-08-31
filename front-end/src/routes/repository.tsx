import { createFileRoute, Link } from "@tanstack/react-router";
import { Library, FileText, Filter, Search, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";

import { TopBar } from "@/components/haca/top-bar";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/repository")({
  head: () => ({
    meta: [
      { title: "Knowledge Repository · HACA Partners — Projet 45" },
      {
        name: "description",
        content:
          "Référentiel documentaire indexé : documents SharePoint accessibles et filtrables par business line et bibliothèque.",
      },
      { property: "og:title", content: "Knowledge Repository · HACA Partners" },
      {
        property: "og:description",
        content: "Sources indexées et accessibles pour le RAG Projet 45.",
      },
    ],
  }),
  component: Repository,
});

type DocumentItem = {
  parentId: string;
  name: string;
  url: string;
  library: string;
  documentType: string;
  businessLine: string;
  primaryTopic: string;
  chunkCount: number;
};

function Repository() {
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [libraryFilter, setLibraryFilter] = useState<string>("all");

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
      // Fallback : utiliser Azure AI Search directement
      if (!response.ok) {
        throw new Error("Backend RAG injoignable");
      }
      const data = await response.json();
      // Dédupliquer par parentId
      const seen = new Set<string>();
      const unique: DocumentItem[] = [];
      for (const item of data.value || []) {
        // Dédupliquer par nom de fichier + library
        const key = `${item.library || ""}|${item.name || ""}`;
        if (!seen.has(key)) {
          seen.add(key);
          unique.push({
            parentId: item.parentId,
            name: item.name || "Sans titre",
            url: item.url || "",
            library: item.library || "—",
            documentType: item.documentType || "—",
            businessLine: item.businessLine || "—",
            primaryTopic: item.primaryTopic || "—",
            chunkCount: 1,
          });
        }
      }
      setDocuments(unique);
    } catch (error) {
      console.error("Erreur chargement repository:", error);
      // Fallback : liste vide
      setDocuments([]);
    } finally {
      setLoading(false);
    }
  };

  const libraries = Array.from(new Set(documents.map((d) => d.library))).sort();

  const filtered = documents.filter((d) => {
    const matchesSearch = d.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          d.businessLine.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          d.primaryTopic.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesLibrary = libraryFilter === "all" || d.library === libraryFilter;
    return matchesSearch && matchesLibrary;
  });

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
              {loading ? "Chargement…" : `${documents.length} documents indexés sur Azure AI Search`}
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex flex-1 items-center gap-2 rounded-xl border border-input bg-card p-2 shadow-fluent-sm focus-within:border-primary">
            <Search className="ml-2 h-5 w-5 shrink-0 text-muted-foreground" />
            <Input
              placeholder="Rechercher un document, une business line, un topic…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="border-0 bg-transparent px-1 py-1.5 text-sm shadow-none focus-visible:ring-0"
            />
          </div>
          <select
            value={libraryFilter}
            onChange={(e) => setLibraryFilter(e.target.value)}
            className="rounded-lg border border-input bg-card px-3 py-2 text-sm shadow-fluent-sm"
          >
            <option value="all">Toutes les bibliothèques</option>
            {libraries.map((lib) => (
              <option key={lib} value={lib}>{lib}</option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="mt-12 text-center text-muted-foreground">
            <p>Chargement des documents…</p>
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((doc) => (
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
        )}

        {!loading && filtered.length === 0 && (
          <div className="mt-12 text-center text-muted-foreground">
            <p>Aucun document trouvé.</p>
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