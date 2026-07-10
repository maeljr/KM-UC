import { useRef, useState } from "react";
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
  PanelRightClose,
  PanelRightOpen,
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
} from "lucide-react";

import { TopBar } from "@/components/haca/top-bar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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
import { botService } from "@/services/botService";


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

type Source = {
  id: string;
  title: string;
  location: string;
  ref: string;
  excerpt: string;
  confidence: number;
};

const sources: Source[] = [
  {
    id: "src-1",
    title: "CSSF Circular 20/750 — ICT and Security Risk Management",
    location: "Section 4.2 · Page 18",
    ref: "CSSF 20/750",
    excerpt:
      "Financial entities must implement a documented governance framework for ICT and security risk, reviewed at least annually.",
    confidence: 94,
  },
  {
    id: "src-2",
    title: "EBA Guidelines on Outsourcing Arrangements (EBA/GL/2019/02)",
    location: "Title IV · Para. 75",
    ref: "EBA/GL/2019/02",
    excerpt:
      "Institutions shall maintain a register of all outsourcing arrangements, distinguishing critical or important functions.",
    confidence: 88,
  },
  {
    id: "src-3",
    title: "CRD VI — Capital Requirements Directive (EU) 2024/1619",
    location: "Article 74 · Internal Governance",
    ref: "CRD VI",
    excerpt:
      "Robust governance arrangements include a clear organisational structure with well-defined, transparent lines of responsibility.",
    confidence: 91,
  },
];

function confidenceStyles(score: number) {
  if (score > 90) {
    return "border-success/40 bg-success/15 text-success";
  }
  if (score > 80) {
    return "border-warning/50 bg-warning/20 text-warning-foreground";
  }
  return "border-destructive/40 bg-destructive/10 text-destructive";
}

function KnowledgeAssistant() {
  const [query, setQuery] = useState(
    "What are the ICT governance requirements for Luxembourg-supervised entities?",
  );
  const [showSources, setShowSources] = useState(true);
  const [votes, setVotes] = useState<Record<string, "up" | "down" | null>>({});
  const [attachment, setAttachment] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [deliverableOpen, setDeliverableOpen] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [generatedText, setGeneratedText] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [followUp, setFollowUp] = useState("");
  const [deliverable, setDeliverable] = useState(
    `ICT Governance Requirements — Luxembourg-Supervised Entities

Executive Summary
Luxembourg-supervised entities must maintain a robust ICT governance framework aligned with both CSSF and EBA expectations.

1. Documented Governance Framework
Establish a formal ICT and security risk management policy approved by the management body, reviewed at least annually and after material changes (CSSF 20/750).

2. Clear Lines of Responsibility
Define transparent organisational structures with assigned ownership for ICT risk, including a designated control function independent from operations (CRD VI, Art. 74).

3. Outsourcing Oversight
Maintain a register of all outsourcing arrangements, with enhanced due diligence and exit strategies for critical or important functions (EBA/GL/2019/02).

Conclusion
These obligations are cumulative: an audit should verify documentation, governance ownership, and the outsourcing register jointly.`,
  );

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

  // ======= CONNEXION AU RAG LOCAL =======
  const handleSearch = async () => {
    if (!query.trim() || isSearching) return;
    setIsSearching(true);
    try {
      const response = await botService.sendMessage(query);
      setGeneratedText(response);
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
      const response = await botService.sendMessage(followUp);
      setGeneratedText(prev => prev + "\n\n" + response);
      setFollowUp("");
    } catch (error) {
      console.error("Erreur follow-up:", error);
    } finally {
      setIsSearching(false);
    }
  };

  const handleGenerate = () => {
    setDeliverableOpen(true);
    toast.warning("AI can make mistakes", {
      description:
        "AI can make mistakes. Please always review and verify the generated content before using it.",
      duration: 8000,
      icon: <ShieldAlert className="h-4 w-4" />,
    });
  };

  const handleDownload = () =>
    downloadFile(deliverable, "deliverable.txt", "text/plain;charset=utf-8");

  const handleExport = (format: "word" | "pdf" | "excel") => {
    if (format === "word") {
      downloadFile(deliverable, "deliverable.doc", "application/msword");
    } else if (format === "excel") {
      const csv = deliverable
        .split("\n")
        .map((line) => `"${line.replace(/"/g, '""')}"`)
        .join("\n");
      downloadFile(csv, "deliverable.csv", "text/csv;charset=utf-8");
    } else {
      const win = window.open("", "_blank");
      if (win) {
        win.document.write(
          `<pre style="font-family:Segoe UI,system-ui,sans-serif;white-space:pre-wrap;padding:32px;line-height:1.6">${deliverable
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

      <main className="mx-auto flex max-w-[1600px] flex-col gap-6 px-4 py-6 sm:px-6 lg:flex-row">
        {/* Center column */}
        <section className="min-w-0 flex-1">
          {/* Search */}
          <div className="mx-auto max-w-3xl text-center">
            <Badge
              variant="secondary"
              className="mb-3 gap-1.5 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
            >
              <Sparkles className="h-3 w-3 text-primary" />
              Retrieval Augmented Generation · Azure AI Search
            </Badge>
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              Ask the Knowledge Assistant
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Interrogez les réglementations CSSF & EBA. Chaque réponse est appuyée par des
              citations de sources vérifiées.
            </p>

            <div className="mt-5 flex items-center gap-2 rounded-xl border border-input bg-card p-2 shadow-fluent transition-shadow focus-within:border-primary focus-within:shadow-fluent-lg">
              <Search className="ml-2 h-5 w-5 shrink-0 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder="Posez une question réglementaire…"
                className="min-w-0 flex-1 bg-transparent px-1 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
              />
              <Button size="sm" className="shrink-0 gap-1.5" onClick={handleSearch} disabled={isSearching}>
                {isSearching ? "..." : "Search"}
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

          {/* Answer */}
          <Card className="mt-7 overflow-hidden border-border shadow-fluent">
            <div className="flex items-center justify-between gap-3 border-b border-border bg-secondary/60 px-5 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
                  <Sparkles className="h-4 w-4" />
                </span>
                <span className="truncate text-sm font-semibold text-foreground">
                  Generated Answer
                </span>
              </div>
              <button
                onClick={() => setShowSources((v) => !v)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground lg:flex"
              >
                {showSources ? (
                  <>
                    <PanelRightClose className="h-4 w-4" />
                    <span className="hidden sm:inline">Hide sources</span>
                  </>
                ) : (
                  <>
                    <PanelRightOpen className="h-4 w-4" />
                    <span className="hidden sm:inline">Show sources</span>
                  </>
                )}
              </button>
            </div>

            <div className="space-y-5 px-5 py-6 text-[15px] leading-7 text-foreground sm:px-7">
              {generatedText ? (
                <p>{generatedText}</p>
              ) : (
                <>
                  <p>Luxembourg-supervised entities must maintain a robust ICT governance framework aligned with both CSSF and EBA expectations. The key requirements are as follows:</p>
                  <ol className="space-y-4">
                    {[
                      { title: "Documented governance framework", body: "Establish a formal ICT and security risk management policy approved by the management body, reviewed at least annually and after material changes.", cite: "CSSF 20/750" },
                      { title: "Clear lines of responsibility", body: "Define transparent organisational structures with assigned ownership for ICT risk, including a designated control function independent from operations.", cite: "CRD VI · Art. 74" },
                      { title: "Outsourcing oversight", body: "Maintain a register of all outsourcing arrangements, with enhanced due diligence and exit strategies for critical or important functions.", cite: "EBA/GL/2019/02" }
                    ].map((item, i) => (
                      <li key={item.title} className="flex gap-3">
                        <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent text-xs font-bold text-accent-foreground">{i + 1}</span>
                        <div className="min-w-0">
                          <p className="font-semibold text-foreground">{item.title}</p>
                          <p className="mt-0.5 text-muted-foreground">{item.body} <span className="ml-0.5 inline-flex translate-y-[2px] items-center gap-1 rounded-md border border-primary/30 px-2 py-0.5 text-[10px] font-semibold text-primary"><FileText className="h-3 w-3" />{item.cite}</span></p>
                        </div>
                      </li>
                    ))}
                  </ol>
                  <p className="text-muted-foreground">These obligations are cumulative: an audit should verify documentation, governance ownership, and the outsourcing register jointly.</p>
                </>
              )}
            </div>
          </Card>

          {/* Follow-up + actions (Footer / Bottom) */}
          <div className="mt-6 rounded-xl border border-border bg-card p-3 shadow-fluent">
            <div className="flex items-center gap-2 rounded-lg border border-input bg-background px-2 py-1.5 focus-within:border-primary">
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                onChange={onPickFile}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title="Joindre un PDF en contexte"
                aria-label="Joindre un PDF en contexte"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-primary"
              >
                <Paperclip className="h-4 w-4" />
              </button>
              <input
                value={followUp}
                onChange={(e) => setFollowUp(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleFollowUp()}
                placeholder="Ask a follow-up question…"
                className="min-w-0 flex-1 bg-transparent py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
              />
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-primary" onClick={handleFollowUp} disabled={isSearching}>
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
            {attachment && (
              <div className="mt-2 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-1.5">
                <FileText className="h-4 w-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                  {attachment.name}
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  {(attachment.size / 1024).toFixed(0)} Ko
                </span>
                <button
                  type="button"
                  onClick={() => setAttachment(null)}
                  aria-label="Retirer la pièce jointe"
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-destructive"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
              <Button
                variant="outline"
                className="gap-2"
                onClick={handleGenerate}
              >
                <FileOutput className="h-4 w-4" />
                Generate Deliverable
              </Button>

              {/* Manager-only */}
              <Button asChild className="gap-2">
                <Link to="/regwatch">
                  <ShieldAlert className="h-4 w-4" />
                  View RegWatch Alerts
                  <Badge
                    variant="secondary"
                    className="ml-0.5 h-4 bg-primary-foreground/15 px-1.5 text-[9px] font-bold uppercase text-primary-foreground"
                  >
                    Manager
                  </Badge>
                </Link>
              </Button>
            </div>
          </div>
        </section>

        {/* Detachable right sidebar */}
        {showSources && (
          <aside className="w-full shrink-0 lg:w-[340px] xl:w-[380px]">
            <div className="lg:sticky lg:top-[88px]">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="grid h-6 w-6 place-items-center rounded-md bg-success/15 text-success">
                    <FileText className="h-3.5 w-3.5" />
                  </span>
                  <h2 className="text-sm font-semibold text-foreground">
                    Verified Source Citations
                  </h2>
                </div>
                <Badge variant="secondary" className="text-[11px] font-semibold">
                  {sources.length}
                </Badge>
              </div>

              <div className="space-y-3">
                {sources.map((s) => (
                  <Card key={s.id} className="border-border p-4 shadow-fluent-sm transition-shadow hover:shadow-fluent">
                    <div className="flex items-start justify-between gap-2">
                      <Badge
                        variant="outline"
                        className="shrink-0 border-primary/30 text-[10px] font-semibold text-primary"
                      >
                        {s.ref}
                      </Badge>
                      <button className="text-muted-foreground transition-colors hover:text-primary">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <p className="mt-2 text-sm font-semibold leading-snug text-foreground">
                      {s.title}
                    </p>
                    <p className="mt-1.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3" />
                      {s.location}
                    </p>
                    <p className="mt-2 border-l-2 border-border pl-2.5 text-xs italic leading-relaxed text-muted-foreground">
                      “{s.excerpt}”
                    </p>
                    <div className="mt-3 flex items-center gap-1.5">
                      <button
                        onClick={() => vote(s.id, "up")}
                        className={cn(
                          "inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors",
                          votes[s.id] === "up"
                            ? "border-success/40 bg-success/15 text-success"
                            : "border-border text-muted-foreground hover:bg-secondary hover:text-foreground",
                        )}
                        aria-label="Relevant source"
                      >
                        <ThumbsUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => vote(s.id, "down")}
                        className={cn(
                          "inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors",
                          votes[s.id] === "down"
                            ? "border-destructive/40 bg-destructive/10 text-destructive"
                            : "border-border text-muted-foreground hover:bg-secondary hover:text-foreground",
                        )}
                        aria-label="Irrelevant source"
                      >
                        <ThumbsDown className="h-3.5 w-3.5" />
                      </button>
                      <span
                        className={cn(
                          "ml-auto inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-bold tabular-nums shadow-fluent-sm",
                          confidenceStyles(s.confidence),
                        )}
                      >
                        <ShieldCheck className="h-3.5 w-3.5" />
                        {s.confidence}%
                      </span>

                    </div>
                  </Card>
                ))}
              </div>
            </div>
          </aside>
        )}
      </main>

      {/* Document Generation Output panel */}
      <Sheet open={deliverableOpen} onOpenChange={setDeliverableOpen}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
        >
          <SheetHeader className="border-b border-border px-5 py-4 text-left">
            <SheetTitle className="flex items-center gap-2 text-base">
              <span className="grid h-7 w-7 place-items-center rounded-md bg-[hsl(0_72%_51%)]/10 text-[hsl(0_72%_51%)]">
                <FileOutput className="h-4 w-4" />
              </span>
              Document Generation Output
            </SheetTitle>
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-4 px-5 py-4">
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-md border border-[hsl(0_72%_51%)]/30 bg-[hsl(0_72%_51%)]/10 px-3 py-2.5 text-[hsl(0_72%_51%)]"
            >
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="text-xs font-medium leading-relaxed">
                AI can make mistakes. Please always review and verify the
                generated content before using it.
              </p>
            </div>

            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Generated Content (editable)
            </label>
            <Textarea
              value={deliverable}
              onChange={(e) => setDeliverable(e.target.value)}
              className="min-h-0 flex-1 resize-none font-mono text-sm leading-relaxed focus-visible:ring-[hsl(0_72%_51%)]"
              placeholder="The assistant's generated document will appear here. You can edit it freely…"
            />

            {showPreview && (
              <div className="max-h-56 overflow-auto rounded-md border border-[hsl(0_72%_51%)]/30 bg-secondary/40 p-4">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[hsl(0_72%_51%)]">
                  Preview
                </p>
                <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground">
                  {deliverable}
                </pre>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                variant="outline"
                className="gap-2 hover:border-[hsl(0_72%_51%)]/50 hover:text-[hsl(0_72%_51%)]"
                onClick={() => setShowPreview((v) => !v)}
              >
                <Eye className="h-4 w-4" />
                {showPreview ? "Hide Preview" : "Preview"}
              </Button>

              <Button
                variant="outline"
                className="gap-2 hover:border-[hsl(0_72%_51%)]/50 hover:text-[hsl(0_72%_51%)]"
                onClick={handleDownload}
              >
                <Download className="h-4 w-4" />
                Download
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button className="gap-2 bg-[hsl(0_72%_51%)] text-white hover:bg-[hsl(0_72%_45%)]">
                    <FileOutput className="h-4 w-4" />
                    Export
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuLabel>Export format</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => handleExport("word")}
                    className="gap-2 focus:text-[hsl(0_72%_51%)] [&_svg]:text-[hsl(0_72%_51%)]"
                  >
                    <FileType className="h-4 w-4" />
                    Word
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleExport("pdf")}
                    className="gap-2 focus:text-[hsl(0_72%_51%)] [&_svg]:text-[hsl(0_72%_51%)]"
                  >
                    <FileText className="h-4 w-4" />
                    PDF
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleExport("excel")}
                    className="gap-2 focus:text-[hsl(0_72%_51%)] [&_svg]:text-[hsl(0_72%_51%)]"
                  >
                    <FileSpreadsheet className="h-4 w-4" />
                    Excel
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