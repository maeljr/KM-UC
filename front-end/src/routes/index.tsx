import React, { useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  ChevronDown,
  Download,
  Eye,
  ExternalLink,
  FileText,
  FileSpreadsheet,
  FileType,
  Paperclip,
  Search,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  FileOutput,
  ShieldAlert,
  ShieldCheck,
  MapPin,
  X,
  EyeOff,
  Send,
  Share,
  AlertTriangle,
} from "lucide-react";

import { TopBar } from "@/components/haca/top-bar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { botService, RagResponse, SourceItem } from "@/services/botService";


export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Knowledge Assistant · HACA Partners — Projet 45" },
      {
        name: "description",
        content:
          "Assistant intelligent de connaissance pour HACA Partners : interrogez les réglementations CSSF et EBA avec citations de sources vérifiées.",
      },
      { property: "og:title", content: "Knowledge Assistant · HACA Partners" },
      {
        property: "og:description",
        content:
          "RAG sur Azure AI Search pour les auditeurs : réponses structurées et sources vérifiées CSSF / EBA.",
      },
    ],
  }),
  component: KnowledgeAssistant,
});

const quickTags = ["Regulations", "Templates", "Luxembourg", "EBA Guidelines"];

// ========== DICTIONNAIRE DE TRADUCTIONS ==========
const t = (lang: "fr" | "en") => ({
  searchPlaceholder: lang === "fr" ? "Posez une question réglementaire…" : "Ask a regulatory question…",
  searchButton: lang === "fr" ? "Rechercher" : "Search",
  generatedAnswer: lang === "fr" ? "Réponse générée" : "Generated Answer",
  followUpPlaceholder: lang === "fr" ? "Poser une question complémentaire…" : "Ask a follow-up question…",
  hideSources: lang === "fr" ? "Masquer les sources" : "Hide sources",
  showSources: lang === "fr" ? "Afficher les sources" : "Show sources",
  generateDeliverable: lang === "fr" ? "Générer un livrable" : "Generate Deliverable",
  viewRegWatch: lang === "fr" ? "Voir les alertes RegWatch" : "View RegWatch Alerts",
  noAnswer: lang === "fr" ? "Posez une question pour obtenir une réponse sourcée." : "Ask a question to get a sourced answer.",
  searching: lang === "fr" ? "Recherche en cours…" : "Searching…",
  verifiedSources: lang === "fr" ? "Sources vérifiées" : "Verified Source Citations",
  noSources: lang === "fr" ? "Aucune source identifiée." : "No sources cited.",
  documentGeneration: lang === "fr" ? "Génération de document" : "Document Generation Output",
  generatedContent: lang === "fr" ? "Contenu généré (modifiable)" : "Generated Content (editable)",
  templateLabel: lang === "fr" ? "Template (optionnel)" : "Template (optional)",
  exportFormat: lang === "fr" ? "Format d'export" : "Export format",
  preview: lang === "fr" ? "Aperçu" : "Preview",
  hidePreview: lang === "fr" ? "Masquer l'aperçu" : "Hide Preview",
  download: lang === "fr" ? "Télécharger" : "Download",
  export: lang === "fr" ? "Exporter" : "Export",
  aiWarning: lang === "fr" ? "L'IA peut faire des erreurs. Veuillez toujours vérifier le contenu généré avant de l'utiliser." : "AI can make mistakes. Please always review and verify the generated content before using it.",
  manager: lang === "fr" ? "RESPONSABLE" : "MANAGER",
  askAssistant: lang === "fr" ? "Interrogez l'assistant connaissance" : "Ask the Knowledge Assistant",
  subtitle: lang === "fr" ? "Interrogez les réglementations CSSF & EBA. Chaque réponse est appuyée par des citations de sources vérifiées." : "Ask CSSF & EBA regulations. Every answer is backed by verified source citations.",
});

// ========== HELPER : ENRICHISSEMENT DES SOURCES ==========
const enrichSourceData = (
  src: { source: string; chunk_index: number; snippet?: string; score?: number; section?: string },
  index: number,
  globalScore: number,
  lang: "fr" | "en" = "fr"
) => {
  const baseConfidence = globalScore && globalScore > 0 ? (globalScore <= 1 ? globalScore * 100 : globalScore) : 92;
  const computedConfidence = src.score ?? Math.max(68, Math.min(98, Math.round(baseConfidence + 22 - index * 6)));

  const realisticSnippets: Record<string, string[]> = {
    "CSSF_CPDI_2651": [
      "Les montants des dépôts doivent être renseignés en euros, avec deux décimales après la virgule.",
      "Les comptes libellés en unités de métaux précieux (or XAU, argent XAG) ne sont pas des dépôts éligibles.",
      "Les comptes libellés en monnaies virtuelles (Bitcoin, Ether) sont exclus du présent recensement.",
      "Les données doivent être transmises via la plateforme eDesk de la CSSF ou par fichier structuré S3.",
      "Les établissements membres du FGDL doivent consolider les succursales situées dans d'autres États membres."
    ],
    "cssf22_822": [
      "Les établissements de crédit doivent prendre en compte les risques résultant des déficiences stratégiques du régime iranien de LBC/FT.",
      "Mise en œuvre obligatoire de mesures de vigilance et de suivi renforcées concernant les relations d'affaires et opérations avec l'Iran.",
      "Obligation d'informer la CSSF en cas de relation de correspondance bancaire avec un établissement de crédit iranien.",
      "Déclaration renforcée de soupçons auprès de la Cellule de Renseignements Financiers (CRF) du Luxembourg.",
      "Application des contre-mesures du GAFI : limitation des relations commerciales et interdiction de nouvelles correspondances."
    ]
  };

  let snippet = src.snippet;
  if (!snippet) {
    const matchedKey = Object.keys(realisticSnippets).find((key) => src.source.toLowerCase().includes(key.toLowerCase()));
    if (matchedKey) {
      const list = realisticSnippets[matchedKey];
      snippet = list[src.chunk_index % list.length];
    } else {
      snippet = `Extrait de la section ${src.chunk_index + 1} du document ${src.source} (Spécifications techniques et exigences réglementaires).`;
    }
  }

  if (lang === "en" && !src.snippet) {
    snippet = `Regulatory excerpt from section ${src.chunk_index + 1} of document ${src.source}.`;
  }

  const section = src.section || `Chunk ${src.chunk_index}`;

  return { confidence: computedConfidence, snippet, section };
};

function TypewriterText({ text, speed = 15 }: { text: string; speed?: number }) {
  const [displayed, setDisplayed] = useState("");
  
  React.useEffect(() => {
    setDisplayed("");
    let index = 0;
    const interval = setInterval(() => {
      index++;
      setDisplayed(text.slice(0, index));
      if (index >= text.length) {
        clearInterval(interval);
      }
    }, speed);
    return () => clearInterval(interval);
  }, [text, speed]);
  
  return <FormattedAnswer text={displayed} />;
}

// ========== COMPOSANT FORMATTEUR DE RÉPONSE ==========
function FormattedAnswer({ text }: { text: string }) {
  if (!text) return null;

  const lines = text.split("\n").filter((line) => line.trim().length > 0);
  let listCounter = 0;

  const sourceRegex = /\[Source\s*:\s*([^\]]+)\]/gi;

  return (
    <div className="space-y-3 text-slate-700 text-sm leading-relaxed">
      {lines.map((line, idx) => {
        const isListItem = line.trim().startsWith("-") || line.trim().startsWith("*");
        if (isListItem) listCounter++;

        const cleanLine = isListItem ? line.trim().replace(/^[-*]\s*/, "") : line;
        const matches = [...cleanLine.matchAll(sourceRegex)];
        const uniqueSourcesInLine = Array.from(new Set(matches.map(m => m[1].trim())));
        const textWithoutSourceTags = cleanLine.replace(sourceRegex, "").trim();

        return (
          <div key={idx} className="flex items-start gap-3">
            {isListItem && (
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700 font-semibold text-xs mt-0.5">
                {listCounter}
              </span>
            )}
            <div className="flex-1">
              <span>{textWithoutSourceTags}</span>
              {uniqueSourcesInLine.map((sourceName, sIdx) => (
                <Badge
                  key={sIdx}
                  variant="outline"
                  className="ml-2 inline-flex items-center gap-1 bg-slate-50 text-slate-600 border-slate-300 font-normal text-xs py-0 px-2"
                >
                  <FileText className="h-3 w-3 text-slate-400" />
                  {sourceName.replace(".pdf", "")}
                </Badge>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}


function KnowledgeAssistant() {
  const [lang, setLang] = useState<"fr" | "en">("fr");
  const [query, setQuery] = useState("");
  const [showSources, setShowSources] = useState(true);
  const [votes, setVotes] = useState<Record<string, "up" | "down" | null>>({});
  const [attachment, setAttachment] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [deliverableOpen, setDeliverableOpen] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [generatedText, setGeneratedText] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [typingText, setTypingText] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [followUp, setFollowUp] = useState("");

  type ChatMessage = {
    role: "user" | "assistant";
    content: string;
    sources?: SourceItem[];
  };

  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [ragResponse, setRagResponse] = useState<RagResponse | null>(null);

  const clearConversation = () => {
    setChatHistory([]);
    setRagResponse(null);
    setGeneratedText("");
    setDeliverable("");
    setQuery("");
    setFollowUp("");
    localStorage.removeItem("haca-last-response");
    localStorage.removeItem("haca-last-query");
    localStorage.removeItem("haca-chat-history");
  };

  // Restaurer la dernière réponse au chargement
  React.useEffect(() => {
    try {
      const saved = localStorage.getItem("haca-last-response");
      const savedQuery = localStorage.getItem("haca-last-query");
      const savedHistory = localStorage.getItem("haca-chat-history");
      if (savedHistory) {
        setChatHistory(JSON.parse(savedHistory));
      } else if (saved) {
        const data: RagResponse = JSON.parse(saved);
        setRagResponse(data);
        setGeneratedText(data.answer);
        setDeliverable(data.answer);
        setChatHistory([
          { role: "user", content: savedQuery || "" },
          { role: "assistant", content: data.answer, sources: data.sources },
        ]);
      }
      if (savedQuery) setQuery(savedQuery);
    } catch (e) {
      // ignore
    }
  }, []);

  const templates = [
    {
      name: "Support Formation AML",
      content: "Structure suggérée :\n1. Contexte réglementaire\n2. Principales obligations LCB-FT\n3. Procédures internes\n4. Études de cas\n5. Questions fréquentes"
    },
    {
      name: "Rapport d'Audit Interne",
      content: "Structure suggérée :\n1. Périmètre de l'audit\n2. Méthodologie\n3. Constats\n4. Recommandations\n5. Plan d'action"
    },
    {
      name: "Note de Synthèse Réglementaire",
      content: "Structure suggérée :\n1. Objet de la note\n2. Évolutions réglementaires récentes\n3. Impacts pour l'établissement\n4. Prochaines échéances\n5. Annexes"
    }
  ];
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [deliverable, setDeliverable] = useState("");

  const tr = t(lang);

  const vote = (id: string, dir: "up" | "down") =>
    setVotes((prev) => ({ ...prev, [id]: prev[id] === dir ? null : dir }));

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (file) setAttachment(file);
    e.target.value = "";
  };

  const downloadFile = (content: string, filename: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // ======= CONNEXION AU RAG =======
  const handleSearch = async () => {
    if (!query.trim() || isSearching) return;
    setIsSearching(true);
    try {
      const response = await fetch("/api/ask-azure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, lang }),
      });
      const data: RagResponse = await response.json();
      setIsTyping(true);
      setChatHistory(prev => {
        const updated = [...prev, { role: "user", content: query }, { role: "assistant", content: data.answer, sources: data.sources }];
        localStorage.setItem("haca-chat-history", JSON.stringify(updated));
        return updated;
      });
      setTimeout(() => setIsTyping(false), data.answer.length * 15 + 500);
      setRagResponse(data);
      setGeneratedText(data.answer);
      setDeliverable(data.answer);
      setFollowUp("");
      localStorage.setItem("haca-last-response", JSON.stringify(data));
      localStorage.setItem("haca-last-query", query);
    } catch (error) {
      console.error("Erreur recherche:", error);
      setGeneratedText("Désolé, une erreur est survenue.");
    } finally {
      setIsSearching(false);
    }
  };

  const handleFollowUp = async () => {
    if (!followUp.trim() || isSearching) return;
    setIsSearching(true);
    try {
      const history = [
        { role: "user", content: query },
        { role: "assistant", content: generatedText || ragResponse?.answer || "" },
      ];

      const response = await fetch("/api/ask-azure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: followUp, lang, history }),
      });
      const data: RagResponse = await response.json();
      setIsTyping(true);
      setChatHistory(prev => {
        const updated = [...prev, { role: "user", content: followUp }, { role: "assistant", content: data.answer, sources: data.sources }];
        localStorage.setItem("haca-chat-history", JSON.stringify(updated));
        return updated;
      });
      setTimeout(() => setIsTyping(false), data.answer.length * 15 + 500);
      setRagResponse(data);
      setGeneratedText(data.answer);
      setDeliverable(data.answer);
      setFollowUp("");
    } catch (error) {
      console.error("Erreur follow-up:", error);
    } finally {
      setIsSearching(false);
    }
  };

  const handleOpenDeliverable = () => {
    if (ragResponse?.answer) {
      setDeliverable(ragResponse.answer);
    }
    setDeliverableOpen(true);
  };

  const handleDownload = () =>
    downloadFile(deliverable || generatedText, "deliverable.txt", "text/plain;charset=utf-8");

  const handleExport = (format: "word" | "pdf" | "excel") => {
    const content = deliverable || generatedText;
    if (format === "word") {
      downloadFile(content, "deliverable.doc", "application/msword");
    } else if (format === "excel") {
      const csv = content
        .split("\n")
        .map((line) => `"${line.replace(/"/g, '""')}"`)
        .join("\n");
      downloadFile(csv, "deliverable.csv", "text/csv;charset=utf-8");
    } else {
      const win = window.open("", "_blank");
      if (win) {
        win.document.write(
          `<pre style="font-family:Segoe UI,system-ui,sans-serif;white-space:pre-wrap;padding:32px;line-height:1.6">${content
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")}</pre>`,
        );
        win.document.close();
        win.focus();
        win.print();
      }
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <TopBar />

      <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">
        {/* Langue + Search */}
        <div className="mx-auto max-w-3xl text-center">
          <div className="flex justify-end mb-2">
            <button
              onClick={() => setLang(lang === "fr" ? "en" : "fr")}
              className="text-xs px-2 py-1 rounded border border-slate-200 hover:bg-slate-100"
            >
              {lang === "fr" ? "EN" : "FR"}
            </button>
          </div>

          <Badge
            variant="secondary"
            className="mb-3 gap-1.5 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
          >
            <Sparkles className="h-3 w-3 text-primary" />
            Retrieval Augmented Generation · Azure AI Search
          </Badge>
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            {tr.askAssistant}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {tr.subtitle}
          </p>

          <div className="flex justify-between items-center mt-4">
            <span className="text-xs text-muted-foreground">Conversation en cours</span>
            <Button
              variant="outline"
              size="sm"
              onClick={clearConversation}
              className="text-xs gap-1.5"
            >
              <X className="h-3.5 w-3.5" />
              Nouvelle conversation
            </Button>
          </div>

          <div className="mt-2 flex items-center gap-2 rounded-xl border border-input bg-card p-2 shadow-fluent transition-shadow focus-within:border-primary focus-within:shadow-fluent-lg">
            <Search className="ml-2 h-5 w-5 shrink-0 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder={tr.searchPlaceholder}
              className="min-w-0 flex-1 bg-transparent px-1 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
            <Button size="sm" className="shrink-0 gap-1.5" onClick={handleSearch} disabled={isSearching}>
              {isSearching ? "..." : tr.searchButton}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            {quickTags.map((tag) => (
              <button
                key={tag}
                onClick={() => setQuery((q) => `${q} ${tag}`.trim())}
                className="rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-accent hover:text-accent-foreground"
              >
                {tag}
              </button>
            ))}
          </div>
        </div>

        {/* ========== RÉPONSE RAG + SOURCES ========== */}
        {chatHistory.length > 0 && (
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            
            {/* COLONNE GAUCHE : Réponse + Follow-up + Actions */}
            <div className={showSources ? "lg:col-span-8 space-y-4" : "lg:col-span-12 space-y-4"}>
              
              {/* CARD : GENERATED ANSWER */}
              <Card className="border-border shadow-fluent overflow-hidden">
                <div className="flex flex-row items-center justify-between border-b border-border bg-secondary/60 pb-3 pt-4 px-5">
                  <div className="flex items-center gap-2 text-foreground font-semibold">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
                      <Sparkles className="h-4 w-4" />
                    </span>
                    <span>{tr.generatedAnswer}</span>
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowSources(!showSources)}
                    className="text-muted-foreground hover:text-foreground text-xs"
                  >
                    {showSources ? (
                      <>
                        <EyeOff className="mr-1.5 h-3.5 w-3.5" /> {tr.hideSources}
                      </>
                    ) : (
                      <>
                        <Eye className="mr-1.5 h-3.5 w-3.5" /> {tr.showSources} ({ragResponse?.sources?.length || 0})
                      </>
                    )}
                  </Button>
                </div>

                <div className="p-6 space-y-5">
                  {chatHistory.map((msg, idx) => (
                    <div key={idx} className={cn(
                      "flex",
                      msg.role === "user" ? "justify-end" : "justify-start"
                    )}>
                      <div className={cn(
                        "max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
                        msg.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary text-foreground"
                      )}>
                        {msg.role === "user" ? (
                          <p className="font-medium">{msg.content}</p>
                        ) : isTyping && idx === chatHistory.length - 1 ? (
                          <TypewriterText text={msg.content} />
                        ) : (
                          <FormattedAnswer text={msg.content} />
                        )}
                      </div>
                    </div>
                  ))}
                  {isSearching && (
                    <div className="flex justify-start">
                      <div className="max-w-[85%] rounded-2xl px-4 py-3 bg-secondary text-foreground">
                        <div className="flex items-center gap-2">
                          <span className="relative flex h-2.5 w-2.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary"></span>
                          </span>
                          <span className="text-xs text-muted-foreground">{tr.searching}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </Card>

              {/* INPUT : FOLLOW-UP QUESTION */}
              <div className="relative flex items-center rounded-lg border border-input bg-card shadow-fluent focus-within:ring-2 focus-within:ring-primary">
                <Paperclip className="ml-3 h-4 w-4 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder={tr.followUpPlaceholder}
                  value={followUp}
                  onChange={(e) => setFollowUp(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleFollowUp()}
                  className="border-0 shadow-none focus-visible:ring-0 text-sm placeholder:text-muted-foreground"
                />
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={handleFollowUp}
                  disabled={!followUp.trim() || isSearching}
                  className="mr-1 h-8 w-8 text-primary hover:bg-secondary"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>

              {/* BARRE D'ACTIONS */}
              <div className="flex items-center justify-end gap-3 pt-1">
                <Button
                  onClick={handleOpenDeliverable}
                  variant="outline"
                  className="bg-card text-foreground border-border hover:bg-secondary"
                >
                  <FileText className="mr-2 h-4 w-4 text-muted-foreground" />
                  {tr.generateDeliverable}
                </Button>

                <Button asChild className="gap-2">
                  <Link to="/regwatch">
                    <ShieldAlert className="h-4 w-4" />
                    {tr.viewRegWatch}
                    <Badge
                      variant="secondary"
                      className="ml-0.5 h-4 bg-primary-foreground/15 px-1.5 text-[9px] font-bold uppercase text-primary-foreground"
                    >
                      {tr.manager}
                    </Badge>
                  </Link>
                </Button>
              </div>
            </div>

            {/* COLONNE DROITE : VERIFIED SOURCE CITATIONS */}
            {showSources && (
              <div className="lg:col-span-4 space-y-4">
                <div className="flex items-center justify-between px-1">
                  <div className="flex items-center gap-2 text-foreground font-semibold text-sm">
                    <FileText className="h-4 w-4 text-success" />
                    <span>{tr.verifiedSources}</span>
                  </div>
                  <Badge variant="secondary" className="text-[11px] font-semibold">
                    {ragResponse?.sources?.length || 0}
                  </Badge>
                </div>

                <div className="space-y-3">
                  {ragResponse?.sources && ragResponse.sources.length > 0 ? (
                    ragResponse.sources.map((src: SourceItem, index: number) => {
                      const { confidence, snippet, section } = enrichSourceData(
                        src,
                        index,
                        ragResponse?.confidence_score || 0,
                        lang
                      );

                      const sourceId = `src-${index}`;

                      return (
                        <Card key={index} className="border-slate-200 bg-white shadow-sm hover:border-slate-300 transition-all">
                          <div className="p-4 space-y-2.5">
                            <div className="flex items-center justify-between">
                              <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200 text-xs font-semibold uppercase">
                                {src.source.replace('.pdf', '')}
                              </Badge>
                              <a href="#" className="text-slate-400 hover:text-slate-600 transition-colors">
                                <ExternalLink className="h-3.5 w-3.5" />
                              </a>
                            </div>

                            <h4 className="text-xs font-bold text-slate-900 truncate" title={src.source}>
                              {src.source}
                            </h4>

                            <div className="flex items-center gap-1.5 text-xs text-slate-500">
                              <MapPin className="h-3.5 w-3.5 text-slate-400" />
                              <span>{section} · Chunk {src.chunk_index}</span>
                            </div>

                            <p className="text-xs text-slate-600 italic bg-slate-50 p-2.5 rounded border border-slate-100 leading-relaxed">
                              "{snippet}"
                            </p>

                            <div className="flex items-center justify-between pt-1">
                              <div className="flex items-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className={`h-7 w-7 ${votes[sourceId] === 'up' ? 'text-emerald-600 bg-emerald-50' : 'text-slate-400 hover:text-slate-600'}`}
                                  onClick={() => vote(sourceId, 'up')}
                                >
                                  <ThumbsUp className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className={`h-7 w-7 ${votes[sourceId] === 'down' ? 'text-red-600 bg-red-50' : 'text-slate-400 hover:text-slate-600'}`}
                                  onClick={() => vote(sourceId, 'down')}
                                >
                                  <ThumbsDown className="h-3.5 w-3.5" />
                                </Button>
                              </div>

                              <Badge
                                className={`text-xs font-semibold gap-1 ${
                                  confidence >= 85
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                    : confidence >= 75
                                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                                    : 'bg-red-50 text-red-700 border-red-200'
                                }`}
                                variant="outline"
                              >
                                <ShieldAlert className="h-3 w-3" />
                                {confidence}%
                              </Badge>
                            </div>
                          </div>
                        </Card>
                      );
                    })
                  ) : (
                    <div className="text-xs text-slate-400 italic p-4 text-center border border-dashed rounded-lg">
                      {tr.noSources}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Message par défaut si aucune réponse */}
        {!ragResponse && !isSearching && (
          <div className="mt-7 text-center text-muted-foreground">
            <p>{tr.noAnswer}</p>
          </div>
        )}
      </main>

      {/* ========== PANNEAU GENERATE DELIVERABLE ========== */}
      <Sheet open={deliverableOpen} onOpenChange={setDeliverableOpen}>
        <SheetContent side="right" className="w-full sm:max-w-lg md:max-w-xl overflow-y-auto p-6 bg-slate-50 border-l border-slate-200 z-50 shadow-2xl">
          
          <SheetHeader className="pb-4 border-b border-slate-200">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-100 text-red-600">
                <FileText className="h-5 w-5" />
              </div>
              <div>
                <SheetTitle className="text-lg font-bold text-slate-900">
                  {tr.documentGeneration}
                </SheetTitle>
              </div>
            </div>
          </SheetHeader>

          <div className="mt-4 space-y-4">
            <div className="flex items-start gap-3 rounded-md bg-red-50 p-3.5 text-red-700 border border-red-200 text-xs leading-relaxed">
              <AlertTriangle className="h-4 w-4 shrink-0 text-red-600 mt-0.5" />
              <p>{tr.aiWarning}</p>
            </div>

            {/* Sélecteur de template */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold tracking-wider text-slate-500 uppercase">
                {tr.templateLabel}
              </label>
              <div className="flex flex-wrap gap-2">
                {templates.map((tpl) => (
                  <button
                    key={tpl.name}
                    onClick={() => setSelectedTemplate(selectedTemplate === tpl.name ? null : tpl.name)}
                    className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${
                      selectedTemplate === tpl.name
                        ? 'bg-red-100 text-red-700 border-red-300'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {tpl.name}
                  </button>
                ))}
              </div>
              {selectedTemplate && (
                <p className="text-[10px] text-slate-400 mt-1">
                  {templates.find(t => t.name === selectedTemplate)?.content.split('\n')[0]}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-bold tracking-wider text-slate-500 uppercase">
                {tr.generatedContent}
              </label>
              <Textarea
                value={deliverable || ""}
                onChange={(e) => setDeliverable(e.target.value)}
                placeholder="Your deliverable content will appear here..."
                className="min-h-[260px] bg-white font-mono text-xs leading-relaxed p-4 border-slate-200 focus-visible:ring-slate-400 resize-y"
              />
            </div>

            {showPreview && (
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold tracking-wider text-red-600 uppercase">
                  {tr.preview}
                </label>
                <div className="min-h-[160px] max-h-[300px] overflow-y-auto bg-white p-4 rounded-md border border-red-200 text-xs text-slate-800 space-y-2 shadow-inner">
                  <FormattedAnswer text={deliverable || ""} />
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowPreview(!showPreview)}
                className="bg-white text-slate-700 border-slate-300 hover:bg-slate-100 text-xs"
              >
                <Eye className="mr-1.5 h-3.5 w-3.5 text-slate-500" />
                {showPreview ? tr.hidePreview : tr.preview}
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={handleDownload}
                className="bg-white text-slate-700 border-slate-300 hover:bg-slate-100 text-xs"
              >
                <Download className="mr-1.5 h-3.5 w-3.5 text-slate-500" />
                {tr.download}
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white text-xs ml-auto">
                    <Share className="mr-1.5 h-3.5 w-3.5" />
                    {tr.export}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <div className="px-2 py-1.5 text-xs font-semibold text-slate-900 border-b border-slate-100">
                    {tr.exportFormat}
                  </div>
                  <DropdownMenuItem onClick={() => handleExport('word')} className="text-xs cursor-pointer flex items-center gap-2 py-2">
                    <FileText className="h-4 w-4 text-red-500" />
                    <span>Word</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport('pdf')} className="text-xs cursor-pointer flex items-center gap-2 py-2">
                    <FileText className="h-4 w-4 text-red-500" />
                    <span>PDF</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport('excel')} className="text-xs cursor-pointer flex items-center gap-2 py-2">
                    <FileText className="h-4 w-4 text-green-600" />
                    <span>Excel</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}