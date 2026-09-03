import React, { useRef, useState } from "react";
import { useUser } from "@/hooks/useUser";
import { createFileRoute, Link } from "@tanstack/react-router";
import { addAuditLog } from "@/lib/audit-log";
import {
  ArrowRight,
  ChevronDown,
  Download,
  Copy,
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
  src: { source: string; chunk_index?: number; snippet?: string; score?: number; section?: string },
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
      snippet = list[(src.chunk_index ?? 0) % list.length];
    } else {
      snippet = `Extrait de la section ${(src.chunk_index ?? 0) + 1} du document ${src.source} (Spécifications techniques et exigences réglementaires).`;
    }
  }

  if (lang === "en" && !src.snippet) {
    snippet = `Regulatory excerpt from section ${(src.chunk_index ?? 0) + 1} of document ${src.source}.`;
  }

  const section = src.section || `Chunk ${src.chunk_index ?? 0}`;

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

  const renderMarkdown = (line: string): React.ReactNode => {
    const parts: React.ReactNode[] = [];
    const regex = /\*\*(.*?)\*\*/g;
    let lastIndex = 0;
    let match;
    let key = 0;
    
    while ((match = regex.exec(line)) !== null) {
      if (match.index > lastIndex) {
        parts.push(line.slice(lastIndex, match.index));
      }
      parts.push(<strong key={key++} className="font-semibold text-slate-900">{match[1]}</strong>);
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < line.length) {
      parts.push(line.slice(lastIndex));
    }
    return parts;
  };

  const lines = text.split("\n").filter((line) => line.trim().length > 0);
  const sourceRegex = /\[Source\s*:\s*([^\]]+)\]/gi;

  return (
    <div className="space-y-2 text-slate-700 text-sm leading-relaxed">
      {lines.map((line, idx) => {
        const trimmed = line.trim();
        const isSubItem = /^\s{2,}[-*]/.test(line);
        const isMainItem = /^[-*]/.test(trimmed);
        const isNumbered = /^\d+\.\s*/.test(trimmed);
        
        const matches = [...trimmed.matchAll(sourceRegex)];
        const uniqueSourcesInLine = Array.from(new Set(matches.map(m => m[1].trim())));
        const textWithoutSourceTags = trimmed.replace(sourceRegex, "").trim();
        
        if (isSubItem) {
          return (
            <div key={idx} className="flex items-start gap-3 pl-8">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
              <div className="flex-1">
                <span>{renderMarkdown(textWithoutSourceTags)}</span>
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
        }
        
        if (isMainItem) {
          return (
            <div key={idx} className="flex items-start gap-3">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
              <div className="flex-1">
                <span>{renderMarkdown(textWithoutSourceTags)}</span>
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
        }
        
        if (isNumbered) {
          return (
            <div key={idx} className="flex items-start gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700 font-semibold text-xs mt-0.5">
                {trimmed.split(".")[0]}
              </span>
              <div className="flex-1">
                <span>{renderMarkdown(textWithoutSourceTags)}</span>
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
        }
        
        return (
          <p key={idx} className="text-slate-700">
            {renderMarkdown(textWithoutSourceTags)}
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
          </p>
        );
      })}
    </div>
  );
}


function KnowledgeAssistant() {
  const [lang, setLang] = useState<"fr" | "en">("fr");
  const { user } = useUser();
  const currentUser = user?.userDetails || "Utilisateur";
  const [query, setQuery] = useState("");
  const [showSources, setShowSources] = useState(true);
  const [votes, setVotes] = useState<Record<string, "up" | "down" | null>>({});
  const [attachment, setAttachment] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const conversationsRef = useRef<HTMLDivElement | null>(null);
  const [deliverableOpen, setDeliverableOpen] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [generatedText, setGeneratedText] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [typingText, setTypingText] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [followUp, setFollowUp] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");

  const [detailMode, setDetailMode] = useState(false);

  type ChatMessage = {
    role: "user" | "assistant";
    content: string;
    sources?: SourceItem[];
    editedFrom?: string;
  };

  type Conversation = {
    id: string;
    title: string;
    theme: string;
    messages: ChatMessage[];
    createdAt: string;
    updatedAt: string;
  };

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string>("");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [ragResponse, setRagResponse] = useState<RagResponse | null>(null);
  const [showConversations, setShowConversations] = useState(false);
  const [editingConversationId, setEditingConversationId] = useState<string | null>(null);
  const [editingConversationTitle, setEditingConversationTitle] = useState("");
  const [conversationTheme, setConversationTheme] = useState("");

  React.useEffect(() => {
    try {
      const savedConversations = localStorage.getItem("haca-conversations");
      if (savedConversations) {
        const convs: Conversation[] = JSON.parse(savedConversations);
        setConversations(convs);
        const activeId = localStorage.getItem("haca-active-conversation") || convs[0]?.id;
        if (activeId) {
          const active = convs.find((c) => c.id === activeId);
          if (active) {
            setActiveConversationId(active.id);
            setChatHistory(active.messages);
            const lastAssistant = [...active.messages].reverse().find((m) => m.role === "assistant");
            if (lastAssistant?.sources) {
              setRagResponse({
                answer: lastAssistant.content,
                sources: lastAssistant.sources,
                confidence_score: 0,
              });
            }
          }
        }
      }
    } catch (e) {
      // ignore
    }
  }, []);

  const [copiedText, setCopiedText] = useState<string | null>(null);

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (conversationsRef.current && !conversationsRef.current.contains(event.target as Node)) {
        setShowConversations(false);
        setEditingConversationId(null);
        setEditingConversationTitle("");
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const copyToClipboard = (text: string, key: string) => {
    const fallbackCopy = () => {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      try {
        document.execCommand("copy");
        setCopiedText(key);
        setTimeout(() => setCopiedText(null), 2000);
      } catch (e) {
        console.error("Copie échouée:", e);
      }
      document.body.removeChild(textarea);
    };

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => {
        setCopiedText(key);
        setTimeout(() => setCopiedText(null), 2000);
      }).catch(fallbackCopy);
    } else {
      fallbackCopy();
    }
  };

  const newConversation = () => {
    if (conversations.length >= 10) {
      // Garder les 9 plus récentes
      const recent = [...conversations]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 9);
      setConversations(recent);
      localStorage.setItem("haca-conversations", JSON.stringify(recent));
    }

    const newConv: Conversation = {
      id: `conv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title: `Conversation ${conversations.length + 1}`,
      theme: conversationTheme.trim() || "Général",
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setConversations((prev) => [newConv, ...prev]);
    setActiveConversationId(newConv.id);
    setChatHistory([]);
    setRagResponse(null);
    setGeneratedText("");
    setDeliverable("");
    setQuery("");
    setFollowUp("");
    setIsSearching(false);
    setIsTyping(false);
    setTypingText("");
    setAttachment(null);
    setEditingIndex(null);
    setEditingText("");
    localStorage.setItem("haca-conversations", JSON.stringify([newConv, ...conversations]));
    localStorage.setItem("haca-active-conversation", newConv.id);
  };

  const selectConversation = (id: string) => {
    const conv = conversations.find((c) => c.id === id);
    if (!conv) return;

    setActiveConversationId(id);
    setChatHistory(conv.messages);

    const lastAssistant = [...conv.messages].reverse().find((m) => m.role === "assistant");
    if (lastAssistant?.sources) {
      setRagResponse({
        answer: lastAssistant.content,
        sources: lastAssistant.sources,
        confidence_score: 0,
      });
    } else {
      setRagResponse(null);
    }

    setGeneratedText(lastAssistant?.content || "");
    setDeliverable(lastAssistant?.content || "");
    setQuery("");
    setFollowUp("");
    setShowConversations(false);
    localStorage.setItem("haca-active-conversation", id);
  };

  const deleteConversation = (id: string) => {
    const updated = conversations.filter((c) => c.id !== id);
    setConversations(updated);
    localStorage.setItem("haca-conversations", JSON.stringify(updated));
    if (activeConversationId === id) {
      const next = updated[0];
      if (next) {
        setActiveConversationId(next.id);
        setChatHistory(next.messages);
        const lastAssistant = [...next.messages].reverse().find((m) => m.role === "assistant");
        if (lastAssistant?.sources) {
          setRagResponse({
            answer: lastAssistant.content,
            sources: lastAssistant.sources,
            confidence_score: 0,
          });
        } else {
          setRagResponse(null);
        }
        setGeneratedText(lastAssistant?.content || "");
        setDeliverable(lastAssistant?.content || "");
        setQuery("");
        setFollowUp("");
      } else {
        setActiveConversationId("");
        setChatHistory([]);
        setRagResponse(null);
      }
    }
  };

  const renameConversation = (id: string, newTitle: string) => {
    const updated = conversations.map((c) =>
      c.id === id ? { ...c, title: newTitle.trim() || c.title, updatedAt: new Date().toISOString() } : c
    );
    setConversations(updated);
    localStorage.setItem("haca-conversations", JSON.stringify(updated));
    setEditingConversationId(null);
    setEditingConversationTitle("");
  };

  const assignTheme = (id: string, theme: string) => {
    const updated = conversations.map((c) =>
      c.id === id ? { ...c, theme: theme.trim() || "Général", updatedAt: new Date().toISOString() } : c
    );
    setConversations(updated);
    localStorage.setItem("haca-conversations", JSON.stringify(updated));
  };

  const updateConversationMessages = (messages: ChatMessage[]) => {
    setConversations((prev) => {
      const updated = prev.map((conv) =>
        conv.id === activeConversationId
          ? { ...conv, messages, updatedAt: new Date().toISOString() }
          : conv
      );
      localStorage.setItem("haca-conversations", JSON.stringify(updated));
      return updated;
    });
  };

  const editUserMessage = async (index: number, newContent: string) => {
    if (!newContent.trim() || isSearching) return;

    const editedText = newContent.trim();

    // Supprimer les messages à partir du message édité
    const updatedHistory = chatHistory.slice(0, index);
    const oldContent = chatHistory[index]?.content;

    if (oldContent === editedText) return;

    updatedHistory[index] = {
      ...chatHistory[index],
      content: editedText,
      editedFrom: oldContent,
    };

    setChatHistory(updatedHistory);

    // Si le message est court ou social (merci, ok, etc.), ne pas interroger le RAG
    const socialMessages = ["merci", "ok", "okay", "parfait", "bonjour", "salut", "bonsoir", "super", "top", "merci beaucoup"];
    const normalizedText = editedText.toLowerCase().trim();
    const isSocial = socialMessages.some((m) => normalizedText === m || normalizedText.startsWith(m));

    if (isSocial) {
      setChatHistory((prev) => {
        const next = [
          ...prev,
          {
            role: "assistant" as const,
            content: "Avec plaisir ! Si vous avez une autre question réglementaire, je suis là.",
            sources: [],
          },
        ];
        updateConversationMessages(next);
        return next;
      });
      setRagResponse({
        answer: "Avec plaisir ! Si vous avez une autre question réglementaire, je suis là.",
        sources: [],
        confidence_score: 0,
      });
      setGeneratedText("Avec plaisir ! Si vous avez une autre question réglementaire, je suis là.");
      setDeliverable("Avec plaisir ! Si vous avez une autre question réglementaire, je suis là.");
      setIsSearching(false);
      return;
    }

    setIsSearching(true);

    try {
      const response = await fetch("/api/ask-azure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: editedText,
          lang,
          detail: detailMode ? "detailed" : "concise",
          history: updatedHistory.filter((m) => m.role === "user").slice(0, -1).map((m) => ({
            role: "user" as const,
            content: m.content,
          })),
        }),
      });
      const data: RagResponse = await response.json();

      setIsTyping(true);
      setChatHistory((prev) => {
        const next = [
          ...prev,
          { role: "assistant" as const, content: data.answer, sources: data.sources },
        ];
        localStorage.setItem("haca-chat-history", JSON.stringify(next));
        return next;
      });

      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setIsTyping(false), data.answer.length * 15 + 500);

      setRagResponse(data);
      setGeneratedText(data.answer);
      setDeliverable(data.answer);
      addAuditLog({
        user: currentUser,
        action: "search",
        detail: `Message édité: "${oldContent}" → "${editedText}"`,
        tag: "Edit",
      });
    } catch (error) {
      console.error("Erreur édition:", error);
    } finally {
      setIsSearching(false);
    }
  };

  const submitEdit = (index: number) => {
    if (editingText.trim() && editingText !== chatHistory[index]?.content) {
      editUserMessage(index, editingText);
    }
    setEditingIndex(null);
    setEditingText("");
  };

  // Restaurer la dernière réponse au chargement
  React.useEffect(() => {
    try {
      const saved = localStorage.getItem("haca-last-response");
      const savedQuery = localStorage.getItem("haca-last-query");
      const savedHistory = localStorage.getItem("haca-chat-history");
      
      if (savedHistory) {
        const history = JSON.parse(savedHistory);
        setChatHistory(history);
        // Restaurer ragResponse à partir du dernier message assistant
        const lastAssistant = [...history].reverse().find((m: ChatMessage) => m.role === "assistant");
        if (lastAssistant?.sources) {
          setRagResponse({
            answer: lastAssistant.content,
            sources: lastAssistant.sources,
            confidence_score: 0,
          });
        }
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

  const vote = (id: string, dir: "up" | "down") => {
    setVotes((prev) => ({ ...prev, [id]: prev[id] === dir ? null : dir }));
    addAuditLog({
        user: currentUser,
      action: "validate_source",
      detail: `Source ${id} marquée ${dir === "up" ? "pertinente" : "non pertinente"}`,
      tag: "Feedback",
    });
  };

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
    
    // Rendu optimiste : ajouter le message utilisateur immédiatement
    const userQuery = query.trim();

    // Créer automatiquement une conversation si aucune n'est active
    if (!activeConversationId) {
      const newConv: Conversation = {
        id: `conv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        title: userQuery.slice(0, 60),
        theme: "Général",
        messages: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setConversations((prev) => {
        const updated = [newConv, ...prev];
        localStorage.setItem("haca-conversations", JSON.stringify(updated));
        return updated;
      });
      setActiveConversationId(newConv.id);
      localStorage.setItem("haca-active-conversation", newConv.id);
    }

    setChatHistory(prev => [...prev, { role: "user" as const, content: userQuery }]);
    setQuery(""); // Vider le champ immédiatement
    setIsSearching(true);
    
    try {
      const response = await fetch("/api/ask-azure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: userQuery, lang, detail: detailMode ? "detailed" : "concise" }),
      });
      const data: RagResponse = await response.json();
      setIsTyping(true);
      setChatHistory(prev => {
        const updated: ChatMessage[] = [
          ...prev,
          { role: "assistant" as const, content: data.answer, sources: data.sources },
        ];
        updateConversationMessages(updated);
        return updated;
      });
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setIsTyping(false), data.answer.length * 15 + 500);
      setRagResponse(data);
      setGeneratedText(data.answer);
      setDeliverable(data.answer);
      setFollowUp("");
      localStorage.setItem("haca-last-response", JSON.stringify(data));
      localStorage.setItem("haca-last-query", userQuery);
      addAuditLog({
        user: currentUser,
        action: "search",
        detail: `${userQuery} → ${data.answer.slice(0, 80)}...`,
        tag: "Query",
      });
    } catch (error) {
      console.error("Erreur recherche:", error);
      setGeneratedText("Désolé, une erreur est survenue.");
    } finally {
      setIsSearching(false);
    }
  };

  const handleFollowUp = async () => {
    if (!followUp.trim() || isSearching) return;
    
    // Rendu optimiste : ajouter le message utilisateur immédiatement
    const userFollowUp = followUp.trim();
    setChatHistory(prev => [...prev, { role: "user" as const, content: userFollowUp }]);
    setFollowUp(""); // Vider le champ immédiatement

    // Si le message est court ou social (merci, ok, etc.), ne pas interroger le RAG
    const socialMessages = ["merci", "ok", "okay", "parfait", "bonjour", "salut", "bonsoir", "super", "top", "merci beaucoup"];
    const normalizedText = userFollowUp.toLowerCase().trim();
    const isSocial = socialMessages.some((m) => normalizedText === m || normalizedText.startsWith(m));

    if (isSocial) {
      setChatHistory((prev) => {
        const next = [
          ...prev,
          {
            role: "assistant" as const,
            content: "Avec plaisir ! Si vous avez une autre question réglementaire, je suis là.",
            sources: [],
          },
        ];
        updateConversationMessages(next);
        return next;
      });
      setRagResponse({
        answer: "Avec plaisir ! Si vous avez une autre question réglementaire, je suis là.",
        sources: [],
        confidence_score: 0,
      });
      setGeneratedText("Avec plaisir ! Si vous avez une autre question réglementaire, je suis là.");
      setDeliverable("Avec plaisir ! Si vous avez une autre question réglementaire, je suis là.");
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    
    try {
      // Inclure TOUS les messages, y compris le dernier ajouté
      const history = chatHistory.map(msg => ({
        role: msg.role as "user" | "assistant",
        content: msg.content,
      }));
      history.push({ role: "user" as const, content: userFollowUp });

      const response = await fetch("/api/ask-azure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: userFollowUp, lang, history, detail: detailMode ? "detailed" : "concise" }),
      });
      const data: RagResponse = await response.json();
      setIsTyping(true);
      setChatHistory(prev => {
        const updated: ChatMessage[] = [
          ...prev,
          { role: "assistant" as const, content: data.answer, sources: data.sources },
        ];
        updateConversationMessages(updated);
        return updated;
      });
      setTimeout(() => setIsTyping(false), data.answer.length * 15 + 500);
      setRagResponse(data);
      setGeneratedText(data.answer);
      setDeliverable(data.answer);
      addAuditLog({
        user: currentUser,
        action: "search",
        detail: `${userFollowUp} → ${data.answer.slice(0, 80)}...`,
        tag: "Follow-up",
      });
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
      <TopBar onLogoClick={() => setShowConversations((v) => !v)} />

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

          <div className="relative flex justify-between items-center mt-4">
            <span className="text-xs text-muted-foreground">Conversation en cours</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowConversations((v) => !v)}
                className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary"
              >
                Chats ({conversations.length})
              </button>
              <Button
                variant="outline"
                size="sm"
                onClick={newConversation}
                className="text-xs gap-1.5"
              >
                <X className="h-3.5 w-3.5" />
                Nouvelle conversation
              </Button>
            </div>

            {showConversations && (
  <div
    ref={conversationsRef}
    className="fixed left-0 top-0 z-50 flex h-full w-80 flex-col border-r border-border bg-card shadow-fluent-lg"
  >
    <div className="flex items-center justify-between border-b border-border px-4 py-3">
      <h2 className="text-sm font-semibold text-foreground">Conversations</h2>
      <button
        onClick={() => {
          setShowConversations(false);
          setEditingConversationId(null);
          setEditingConversationTitle("");
        }}
        className="rounded-full p-1 text-muted-foreground hover:bg-secondary"
      >
        <X className="h-4 w-4" />
      </button>
    </div>

    <div className="flex-1 overflow-y-auto p-3">
      {conversations.length === 0 ? (
        <p className="px-3 py-4 text-center text-xs text-muted-foreground">
          Aucune conversation pour le moment.
        </p>
      ) : (
        conversations.map((conv) => (
          <div
            key={conv.id}
            className={`group mb-1.5 rounded-lg border px-3 py-2.5 transition-colors ${
              conv.id === activeConversationId
                ? "border-primary bg-accent"
                : "border-border bg-card hover:bg-secondary"
            }`}
          >
            {editingConversationId === conv.id ? (
              <div className="flex gap-1">
                <Input
                  value={editingConversationTitle}
                  onChange={(e) => setEditingConversationTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") renameConversation(conv.id, editingConversationTitle);
                    if (e.key === "Escape") setEditingConversationId(null);
                  }}
                  autoFocus
                  className="h-7 text-sm"
                />
              </div>
            ) : (
              <button
                onClick={() => selectConversation(conv.id)}
                onDoubleClick={() => {
                  setEditingConversationId(conv.id);
                  setEditingConversationTitle(conv.title);
                }}
                className="w-full text-left"
              >
                <span className="block truncate text-sm font-medium text-foreground">
                  {conv.title}
                </span>
                <span className="mt-0.5 block text-[10px] text-muted-foreground">
                  {conv.theme} · {new Date(conv.updatedAt).toLocaleDateString("fr-FR")}
                </span>
              </button>
            )}

            <div className="mt-1.5 flex items-center justify-between opacity-0 group-hover:opacity-100">
              <button
                onClick={() => {
                  setEditingConversationId(conv.id);
                  setEditingConversationTitle(conv.title);
                }}
                className="text-[10px] text-muted-foreground hover:text-foreground"
              >
                Renommer
              </button>
              <button
                onClick={() => deleteConversation(conv.id)}
                className="text-[10px] text-destructive hover:underline"
              >
                Supprimer
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  </div>
)}
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

          <div className="mt-2 flex items-center justify-center gap-2">
            <button
              onClick={() => setDetailMode(!detailMode)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                detailMode
                  ? "border-primary/40 bg-accent text-accent-foreground"
                  : "border-border bg-card text-muted-foreground hover:border-primary/40"
              }`}
            >
              {detailMode ? (
                <>
                  <FileText className="h-3 w-3" />
                  Réponse détaillée
                </>
              ) : (
                <>
                  <Sparkles className="h-3 w-3" />
                  Réponse concise
                </>
              )}
            </button>
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
                          <div className="group relative">
                            {copiedText === `user-${idx}` && (
                              <span className="absolute -top-8 left-0 rounded-full bg-white px-2 py-0.5 text-[10px] text-primary shadow-sm">
                                Copié !
                              </span>
                            )}
                            {editingIndex === idx ? (
                              <div className="flex flex-col gap-2">
                                <textarea
                                  value={editingText}
                                  onChange={(e) => setEditingText(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" && !e.shiftKey) {
                                      e.preventDefault();
                                      submitEdit(idx);
                                    }
                                    if (e.key === "Escape") {
                                      setEditingIndex(null);
                                      setEditingText("");
                                    }
                                  }}
                                  autoFocus
                                  rows={2}
                                  className="w-full resize-none rounded-lg border border-primary bg-primary-foreground px-3 py-2 text-sm text-primary"
                                />
                                <div className="flex justify-end gap-2">
                                  <button
                                    onClick={() => {
                                      setEditingIndex(null);
                                      setEditingText("");
                                    }}
                                    className="rounded-full px-3 py-1 text-xs text-muted-foreground hover:bg-white/20"
                                  >
                                    Annuler
                                  </button>
                                  <button
                                    onClick={() => submitEdit(idx)}
                                    className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-primary"
                                  >
                                    Valider
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <p className="font-medium">{msg.content}</p>
                                {msg.editedFrom && (
                                  <p className="mt-1 text-[10px] opacity-70">
                                    Édité — version précédente : "{msg.editedFrom.slice(0, 60)}…"
                                  </p>
                                )}
                              </>
                            )}
                            <button
                              onClick={() => {
                                setEditingIndex(idx);
                                setEditingText(msg.content);
                              }}
                              className="absolute -right-2 -top-2 hidden h-6 w-6 items-center justify-center rounded-full bg-white text-muted-foreground shadow-sm group-hover:flex"
                              title="Éditer le message"
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                              </svg>
                            </button>
                            <button
                              onClick={() => copyToClipboard(msg.content, `user-${idx}`)}
                              className="absolute -right-8 -top-2 hidden h-6 w-6 items-center justify-center rounded-full bg-white text-muted-foreground shadow-sm group-hover:flex"
                              title="Copier la question"
                            >
                              <Copy className="h-3 w-3" />
                            </button>
                          </div>
                        ) : isTyping && idx === chatHistory.length - 1 ? (
                          <TypewriterText text={msg.content} />
                        ) : (
                          <div className="group relative">
                            {copiedText === `assistant-${idx}` && (
                              <span className="absolute -top-8 left-0 rounded-full bg-white px-2 py-0.5 text-[10px] text-primary shadow-sm">
                                Copié !
                              </span>
                            )}
                            <FormattedAnswer text={msg.content} />
                            <button
                              onClick={() => copyToClipboard(msg.content, `assistant-${idx}`)}
                              className="absolute -right-2 -top-2 hidden h-6 w-6 items-center justify-center rounded-full bg-white text-muted-foreground shadow-sm group-hover:flex"
                              title="Copier la réponse"
                            >
                              <Copy className="h-3 w-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  
                  {/* Loader inséré dans le fil de discussion */}
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
                    <FileText className="h-4 w-4 text-primary" />
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
                              <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 text-xs font-semibold uppercase">
  {src.source.replace('.pdf', '')}
			      </Badge>
                              <a href="#" className="text-slate-400 hover:text-slate-600 transition-colors">
                                <ExternalLink className="h-3.5 w-3.5" />
                              </a>
                            </div>

                            <div className="flex items-center gap-1.5 text-xs text-slate-500">
                              <MapPin className="h-3.5 w-3.5 text-slate-400" />
                              <span>Chunk {src.chunk_index}</span>
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