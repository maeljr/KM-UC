import { Fragment, useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  LayoutGrid,
  List as ListIcon,
  Plus,
  RefreshCw,
  Scale,
  Search,
  X,
} from "lucide-react";

import { TopBar } from "@/components/haca/top-bar";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/regwatch")({
  head: () => ({
    meta: [
      { title: "RegWatch · HACA Partners — Projet 45" },
      {
        name: "description",
        content:
          "Surveillance réglementaire automatisée : triage, scoping et tagging des publications CSSF, EBA, ESMA, CNPD et Legilux avec hiérarchie des textes et niveau d'urgence.",
      },
    ],
  }),
  component: RegWatchAgent,
});

type StateKey = "published" | "pending_review" | "rejected";

/* ------------------------------------------------------------------ *
 * The record written by regwatch_scraper.py (frontend_record).
 * Everything is optional so an older regwatch_latest.json still renders.
 * ------------------------------------------------------------------ */
type RegWatchItem = {
  title: string;
  title_original?: string;
  source: string;
  source_code?: string;
  source_category?: string;
  geo?: string;
  date: string;
  link: string;
  nature?: string;
  importance_tier?: number;
  importance_label?: string;
  legal_level?: number | null;
  legal_level_label?: string;
  legal_level_fr?: string;
  legal_force?: number;
  escalation_note?: string;
  document_families?: string[];
  asset_classes?: string[];
  urgency?: "High" | "Medium" | "Low" | "";
  deadline?: string;
  frameworks?: string[];
  sectors?: string[];
  entities?: string[];
  keywords?: string[];
  summary?: string;
  why_kept?: string;
  actions?: string;
  is_alert?: boolean;
  tagged_by?: string;
  cssf_themes?: string[];
  also_from?: string[];
  /* Added with the third-country cap: where the publication comes from,
   * whether it states an EU or Luxembourg nexus, and what the cap changed. */
  jurisdiction?: string;
  eu_nexus?: boolean;
  tier_uncapped?: number | null;
  urgency_uncapped?: string;
  state_reason?: string;
  language?: string;
  duplicate_copies?: number;
  /* Filled in by this page, not by the scraper. */
  _state?: StateKey;
  _ref?: string;
  _fetched?: string;
  /* Came from the merged archive of past runs, not from the run the board is
   * showing. Marked on the card so nobody quotes an old record as today's. */
  _archived?: boolean;
  /* Collected before the three-state gate existed: published, but with no
   * tier, urgency or summary. build_archive.py sets this. */
  _legacy?: boolean;
};

type RegWatchMeta = {
  generated_at?: string;
  finished_at?: string;
  duration_seconds?: number;
  days_window?: number;
  counts?: Record<string, number>;
  sources?: { total?: number; active?: number; producing?: number; failing?: number };
  tagged_by_llm?: number;
  tagged_by_keyword?: number;
};

type SourceHealth = {
  code: string;
  name: string;
  status?: string;
  items?: number;
  unique_items?: number;
  duplicate_items?: number;
  errors?: string[];
  endpoints?: { url: string; kind?: string; items?: number; error?: string | null }[];
};

type BoardPayload = {
  generated_at?: string;
  days_window?: number;
  published?: RegWatchItem[];
  pending_review?: RegWatchItem[];
  rejected?: RegWatchItem[];
  counts?: Record<string, number>;
  sources?: SourceHealth[];
  source_problems?: unknown[];
  tagging_errors?: unknown[];
  tagged_by_llm?: number;
  tagged_by_keyword?: number;
};

/* The same three buckets, but accumulated over every run ever kept, written by
 * build_archive.py. It carries its own coverage dates so the page can say how
 * far back it actually reaches instead of leaving an empty band unexplained. */
type ArchivePayload = BoardPayload & {
  archive?: true;
  runs_merged?: number;
  covers_from?: string | null;
  covers_to?: string | null;
};

type ModuleTab =
  | "pipeline"
  | "processing"
  | "reports"
  | "sources"
  | "configuration"
  | "triage";

const MODULE_TABS: [ModuleTab, string][] = [
  ["pipeline", "Pipeline"],
  ["processing", "Processing"],
  ["reports", "Reports"],
  ["sources", "Sources"],
  ["configuration", "Configuration"],
  ["triage", "Triage"],
];

/* The two states that are WORK. Rejected items are not work - they are the
 * audit trail of the gate - so they live on the Triage tab instead of taking
 * two thirds of the board. In the run of 1 September 2026 that was 77 rejects
 * against 14 published and 14 pending: the eye went to creche approvals
 * instead of CSSF circulars. */
const STATES: { key: StateKey; label: string; dot: string }[] = [
  { key: "published", label: "Approved / published", dot: "bg-success" },
  { key: "pending_review", label: "Pending review", dot: "bg-warning" },
];

const REJECTED_LABEL = "Triaged - out of scope";

/* Every bucket the scraper writes. Kept separate from STATES on purpose:
 * STATES is what the BOARD and the rail show, this is what the loader READS.
 * Conflating the two is how the Triage tab shipped empty - dropping "rejected"
 * from STATES silently stopped the page reading board.rejected at all. */
const ALL_STATES: StateKey[] = ["published", "pending_review", "rejected"];

const POLL_MS = 120_000;

/* How many cards a board column shows before it collapses the rest. A column
 * with 68 items in it makes the board unusable; a column you cannot open makes
 * the items unreachable. So: cap, with a button that lifts the cap. */
const BOARD_PAGE = 40;

const API_BASE = (import.meta.env?.VITE_REGWATCH_API ?? "").replace(/\/$/, "");
const BOARD_URL = API_BASE ? `${API_BASE}/board` : "/regwatch_board.json";
const DATA_URL = API_BASE ? `${API_BASE}/latest` : "/regwatch_latest.json";
const META_URL = API_BASE ? `${API_BASE}/meta` : "/regwatch_meta.json";
/* Every past run merged into one file by build_archive.py. Optional: the page
 * works without it, it just cannot show anything older than the latest run. */
const ARCHIVE_URL = API_BASE ? `${API_BASE}/archive` : "/regwatch_archive.json";

const TIER_BG: Record<number, string> = {
  1: "bg-chart-1",
  2: "bg-chart-1",
  3: "bg-chart-2",
  4: "bg-chart-4",
};

const URGENCY_PILL: Record<string, string> = {
  High: "border-brand/45 text-brand-ink",
  Medium: "border-warning/45 text-warning",
  Low: "border-border text-muted-foreground",
};

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */
function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  return value ? [String(value)] : [];
}

function fmtDate(value?: string) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return [
    String(d.getDate()).padStart(2, "0"),
    String(d.getMonth() + 1).padStart(2, "0"),
    d.getFullYear(),
  ].join("/");
}

function fmtStamp(value?: string) {
  if (!value) return "";
  return `${fmtDate(value)} ${String(value).slice(11, 19)}`;
}

function daysUntil(value?: string) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return Math.round((d.getTime() - Date.now()) / 86_400_000);
}

function guessLanguage(item: RegWatchItem) {
  if (item.language) return item.language;
  const text = item.title_original || item.title || "";
  if (/[àâçéèêëîïôùûœ]/i.test(text) || /\b(le|la|les|des|du|aux|pour|sur|dans)\b/i.test(text)) {
    return "French";
  }
  if (/[äöüß]/i.test(text) || /\b(der|die|das|und|für|zur)\b/i.test(text)) return "German";
  return "English";
}

/* The jurisdiction rule, mirrored from regwatch_scraper.py so a payload
 * written before the rule existed still shows the field instead of a dash.
 * The payload's own value always wins - this is a fallback, not a second
 * source of truth. If the source sets change in the scraper, change them
 * here too, or the page will disagree with the pipeline. */
const LU_SOURCE_CODES = new Set([
  "abbl", "aca", "aed", "alfi", "bcl_communiqu_s", "caa", "chambre_de_commerce",
  "chambre_des_d_put_s", "chambre_des_d_put_s_calendrier_parlementaire",
  "chambre_des_d_put_s_dossiers_parlementaires", "cnpd", "cnpd_avis", "crf",
  "cssf_ai", "cssf_aml_cft", "cssf_crypto", "cssf_dora_ict",
  "cssf_flux_principal", "cssf_outsourcing", "ire", "legilux_memorial_a",
  "legilux_memorial_a_et_b", "legilux_memorial_b", "legilux_projets_de_loi",
  "lpea", "minist_res_gouv_lu", "mj", "pfi_blanchiment",
]);

const NON_EU_SOURCE_CODES = new Set([
  "fatf_gafi", "fca", "fsb_publications", "iais", "iosco",
]);

const NON_EU_GEOS = new Set([
  "united kingdom", "uk", "united states", "usa", "us", "switzerland", "japan",
  "singapore", "china", "hong kong", "canada", "australia",
]);

const EU_NEXUS_RE =
  /\b(luxembourg|luxembourgish|cssf|caa|cnpd|legilux|european union|european commission|european parliament|euro area|eurozone|euro-area|member states?|eu[- ]wide|eu|european banking authority|eba|esma|eiopa|amla|ecb|european central bank|single supervisory|passport(?:ing)?|mifid|dora|aifmd|ucits|crr|crd|psd2|gdpr|mica|emir|sfdr|csrd|solvency ii|amlr|amld)\b/i;

function jurisdictionOf(item: RegWatchItem) {
  if (item.jurisdiction) return item.jurisdiction;
  const code = (item.source_code ?? "").trim().toLowerCase();
  if (!code && !item.geo) return "";
  if (LU_SOURCE_CODES.has(code)) return "Luxembourg";
  if (NON_EU_SOURCE_CODES.has(code)) return "Third country / international";
  if (NON_EU_GEOS.has((item.geo ?? "").trim().toLowerCase())) {
    return "Third country / international";
  }
  return "European Union";
}

/* Judged from the DOCUMENT'S OWN WORDS only. why_kept and actions are our
 * commentary — the prompt asks the model to write why_kept as "why this
 * matters to a Luxembourg financial institution", so it names Luxembourg by
 * construction and would make every item pass. */
function euNexusOf(item: RegWatchItem) {
  if (item.eu_nexus !== undefined) return item.eu_nexus;
  if (asList(item.frameworks).length) return true;
  return [item.title, item.title_original, item.summary].some(
    (t) => !!t && EU_NEXUS_RE.test(String(t)),
  );
}

/* Publication-date windows.
 *
 * The scraper keeps a 7-day window (DAYS_TO_KEEP = 7), so anything longer than
 * that can never differ from "last 7 days" — a "last 30 days" button would
 * always show the same number and teach you nothing. Measured on the run of
 * 31 August 2026: today 15, 3 days 30, 7 days 95, future-dated 4.
 *
 * Future-dated items are real and worth their own filter: a regulator
 * announcing a December training course or an application date publishes the
 * notice now, and that is exactly what you want to see coming. */
/* AGE BANDS, not cumulative ranges.
 *
 * The first version of this offered "last 2 years", which meant everything
 * from today back two years - so selecting it showed today's news, which is
 * the opposite of what anyone wants it for. You reach for "1 to 2 years" to
 * see what was published then, not to include it in a pile with this morning.
 *
 * So every band is exclusive: `from` and `to` are ages in days, inclusive at
 * both ends, and no two bands overlap. Each carries its own count, so an empty
 * band is visible rather than mysterious.
 *
 * How much of this can ever be populated is decided by the scraper's window
 * (REGWATCH_DAYS, 30 by default): anything older was discarded at collection
 * time. The older bands stay listed anyway - an honest zero beats a hidden
 * option, and they fill as the archive of past runs grows. */
const DATE_WINDOWS: {
  key: string;
  label: string;
  from?: number;
  to?: number;
  future?: boolean;
}[] = [
  { key: "today", label: "Today", from: 0, to: 0 },
  { key: "d1_3", label: "1-3 days ago", from: 1, to: 3 },
  { key: "d4_7", label: "4-7 days ago", from: 4, to: 7 },
  { key: "d8_30", label: "8-30 days ago", from: 8, to: 30 },
  { key: "m1_3", label: "1-3 months ago", from: 31, to: 90 },
  { key: "m3_6", label: "3-6 months ago", from: 91, to: 180 },
  { key: "m6_12", label: "6-12 months ago", from: 181, to: 365 },
  { key: "y1_2", label: "1-2 years ago", from: 366, to: 730 },
  { key: "y2plus", label: "Over 2 years ago", from: 731 },
  { key: "future", label: "Future-dated", future: true },
];

/* What makes two records the same publication, so the archive does not show a
 * second copy of something already on the board. Same rule as
 * build_archive.py: the link when there is one, because it is the only field
 * every source agrees on, and title plus date otherwise. */
function identityOf(item: RegWatchItem) {
  const link = String(item.link ?? "")
    .trim()
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
  if (link) return `l:${link}`;
  const title = String(item.title ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  return `t:${title}|${String(item.date ?? "").slice(0, 10)}`;
}

function daysSincePublication(item: RegWatchItem) {
  if (!item.date) return null;
  const published = new Date(String(item.date).slice(0, 10));
  if (Number.isNaN(published.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  published.setHours(0, 0, 0, 0);
  return Math.round((today.getTime() - published.getTime()) / 86_400_000);
}

/* Exclusive age bands, not cumulative ranges.
 *
 * The first version of this filter asked "published within the last N days",
 * so "last 2 years" answered with this morning's circular - technically true
 * and useless, because the reason you pick a two-year band is that you want
 * the old material. Each band now has a floor as well as a ceiling: "1-2
 * years ago" means 366 to 730 days old and nothing else. */
function inDateWindow(item: RegWatchItem, key: string | null) {
  if (!key) return true;
  const band = DATE_WINDOWS.find((w) => w.key === key);
  if (!band) return true;
  const age = daysSincePublication(item);
  if (age == null) return false;
  if (band.future) return age < 0;
  if (age < 0) return false; // a future date is not an age
  if (band.from != null && age < band.from) return false;
  if (band.to != null && age > band.to) return false;
  return true;
}

/* Newest first, in every view.
 *
 * `date` is the publication date for almost everything, but a handful of
 * items carry the date of the thing being announced instead - a CNPD training
 * course in December, say. Those are genuinely the newest by date and would
 * otherwise sit above this morning's circular pretending to be today's news,
 * so they are marked "upcoming" on the card rather than silently reordered. */
function sortNewestFirst(rows: RegWatchItem[]) {
  return [...rows].sort((a, b) => {
    const aAge = daysSincePublication(a);
    const bAge = daysSincePublication(b);
    const aFuture = aAge != null && aAge < 0;
    const bFuture = bAge != null && bAge < 0;

    /* Future-dated items go BELOW today's, not above it. Sorting on the raw
     * date put a December training course at the top of the feed pretending
     * to be the newest thing published, which is the opposite of what
     * "recent first" means to a reader. Within the tail, the soonest event
     * comes first. */
    if (aFuture !== bFuture) return aFuture ? 1 : -1;

    const left = String(a.date ?? "");
    const right = String(b.date ?? "");
    if (left === right) return a.title.localeCompare(b.title);
    if (!left) return 1;
    if (!right) return -1;
    return aFuture ? left.localeCompare(right) : right.localeCompare(left);
  });
}

function isUpcoming(item: RegWatchItem) {
  const age = daysSincePublication(item);
  return age != null && age < 0;
}

function stateLabel(key?: StateKey) {
  if (key === "rejected") return REJECTED_LABEL;
  const found = STATES.find((s) => s.key === key);
  return found ? found.label : String(key ?? "");
}

const GROUPS: Record<string, { label: string; of: (i: RegWatchItem) => string }> = {
  state: { label: "State", of: (i) => stateLabel(i._state) },
  source: { label: "Source", of: (i) => i.source || "—" },
  category: { label: "Source category", of: (i) => i.source_category || "—" },
  jurisdiction: { label: "Jurisdiction", of: (i) => jurisdictionOf(i) || "Not recorded" },
  urgency: { label: "Urgency", of: (i) => i.urgency || "Low" },
  nature: { label: "Regulation type", of: (i) => i.nature || "Other" },
  tier: {
    label: "Importance tier",
    of: (i) => `Tier ${i.importance_tier ?? 4} · ${i.importance_label ?? ""}`.trim(),
  },
  framework: { label: "Framework", of: (i) => asList(i.frameworks)[0] || "None" },
  language: { label: "Language", of: (i) => guessLanguage(i) },
  month: { label: "Publication month", of: (i) => String(i.date ?? "").slice(0, 7) || "—" },
};

/* ------------------------------------------------------------------ *
 * Atoms
 * ------------------------------------------------------------------ */
function Pill({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}

function TierPill({ item }: { item: RegWatchItem }) {
  const tier = Number(item.importance_tier ?? 4);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold text-white",
        TIER_BG[tier] ?? "bg-chart-4",
      )}
    >
      Tier {tier}
    </span>
  );
}

function ForceStars({ force }: { force?: number }) {
  const n = Math.max(0, Math.min(5, Number(force ?? 0)));
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="tracking-[2px] text-brand-ink">
        {"★".repeat(n)}
        <span className="text-border">{"★".repeat(5 - n)}</span>
      </span>
      <span className="text-xs tabular-nums text-muted-foreground">{n}/5</span>
    </span>
  );
}

function Field({
  label,
  help,
  children,
  emptyNote,
}: {
  label: string;
  help?: string;
  children?: React.ReactNode;
  /* What an empty value MEANS, where the pipeline makes that knowable — a
   * deadline is blank because the text stated none, not because we failed to
   * read it. A bare dash cannot tell those two apart. */
  emptyNote?: string;
}) {
  const empty = children === null || children === undefined || children === "";
  return (
    <div className="grid grid-cols-[118px_minmax(0,1fr)] gap-3 py-[3px] text-[13px]">
      <dt className="text-secondary-foreground">
        {label}
        {help ? (
          <span
            title={help}
            className="ml-1 inline-grid h-3.5 w-3.5 translate-y-[1px] place-items-center rounded-full border border-border text-[9px] font-bold text-muted-foreground"
          >
            ?
          </span>
        ) : null}
      </dt>
      <dd className="m-0 break-words">
        {empty ? (
          <span className="italic text-muted-foreground">{emptyNote ?? "—"}</span>
        ) : (
          children
        )}
      </dd>
    </div>
  );
}

/* Chips are clickable and searching is what they do. The module they imitate
 * puts an "x" on each one, but that removes a tag from the record - this page
 * has no write API, so an "x" here would be a button that does nothing. */
function Chips({ values, onPick }: { values?: unknown; onPick?: (v: string) => void }) {
  const list = asList(values);
  /* An empty list used to render nothing at all, which left the value cell
   * blank and looked like the page had failed to load something. It has to
   * read the same as any other empty field. */
  if (!list.length) return <span className="italic text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {list.map((v) =>
        onPick ? (
          <button
            key={v}
            type="button"
            onClick={() => onPick(v)}
            title={`Filter on ${v}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
          >
            {v}
          </button>
        ) : (
          <Pill key={v}>{v}</Pill>
        ),
      )}
    </div>
  );
}

function RailOption({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number | null;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors",
        active
          ? "bg-accent font-semibold text-accent-foreground"
          : "text-muted-foreground hover:bg-secondary hover:text-foreground",
      )}
    >
      <span className={cn("w-3 shrink-0 text-brand-ink", active ? "" : "opacity-0")}>✓</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count == null ? null : (
        <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">{count}</span>
      )}
    </button>
  );
}

function RailHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground first:mt-0">
      {children}
    </p>
  );
}

/* A collapsible group of rail options.
 *
 * Once Sector and Framework are built from the run, the rail is around forty
 * five rows and the filters below the fold might as well not exist. So each
 * group folds, with the number of options on the header so a closed group
 * still tells you whether it is worth opening.
 *
 * One rule that matters: a group holding an ACTIVE filter is always shown,
 * whatever its open state. Otherwise you can collapse a group, forget a filter
 * is set, and spend a while wondering why the board is nearly empty. `active`
 * is the current selection, shown beside the title when closed. */
function RailSection({
  title,
  options,
  active,
  defaultOpen = false,
  children,
}: {
  title: string;
  options: number;
  active?: string | null;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const shown = open || !!active;

  return (
    <div className="mt-5 first:mt-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={shown}
        className="flex w-full items-center gap-1.5 rounded-md py-1 text-left text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 transition-transform",
            shown ? "" : "-rotate-90",
          )}
        />
        <span className="truncate">{title}</span>
        {active ? (
          <span className="ml-auto max-w-[92px] truncate rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-accent-foreground">
            {active}
          </span>
        ) : (
          <span className="ml-auto tabular-nums opacity-60">{options}</span>
        )}
      </button>
      {shown ? <div className="mt-1.5">{children}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The page
 * ------------------------------------------------------------------ */
function RegWatchAgent() {
  const [items, setItems] = useState<RegWatchItem[]>([]);
  const [board, setBoard] = useState<BoardPayload | null>(null);
  const [archive, setArchive] = useState<ArchivePayload | null>(null);
  const [meta, setMeta] = useState<RegWatchMeta | null>(null);
  const [moduleTab, setModuleTab] = useState<ModuleTab>("pipeline");
  const [generatedAt, setGeneratedAt] = useState("");
  const [partial, setPartial] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [view, setView] = useState<"board" | "list">("board");
  const [openRef, setOpenRef] = useState<string | null>(null);
  const [tab, setTab] = useState("content");

  const [query, setQuery] = useState("");
  const [fState, setFState] = useState<StateKey | null>(null);
  const [fSector, setFSector] = useState<string | null>(null);
  const [fFramework, setFFramework] = useState<string | null>(null);
  const [fUrgency, setFUrgency] = useState<string | null>(null);
  const [fTier, setFTier] = useState<number | null>(null);
  const [fFlag, setFFlag] = useState<string | null>(null);
  const [group, setGroup] = useState("state");
  const [fDate, setFDate] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string[]>([]);

  /* `useStamp` is false when the board payload already gave us a run time.
   * regwatch_meta.json and regwatch_board.json are written by the same run,
   * but if one is stale on disk the payload we actually rendered wins - the
   * header must not claim a different run from the items below it. */
  const loadMeta = async (stamp: number, useStamp = true) => {
    try {
      const res = await fetch(`${META_URL}?t=${stamp}`, { cache: "no-store" });
      if (res.ok) {
        const m: RegWatchMeta = await res.json();
        setMeta(m);
        if (useStamp && m.generated_at) setGeneratedAt(m.generated_at);
      }
    } catch {
      /* meta is a nicety; the page works without it */
    }
  };

  /* Every run ever kept, merged by build_archive.py, added to the pool the
   * filters see. The board itself is untouched - "this run" on the Sources tab
   * and in the footer still means this run - but a date band can now reach
   * past the latest run instead of answering zero for everything older.
   *
   * Optional on purpose: a missing file is the normal state on a fresh
   * install, and the page must not break because history does not exist yet. */
  const loadArchive = async (stamp: number, live: RegWatchItem[]) => {
    try {
      const res = await fetch(`${ARCHIVE_URL}?t=${stamp}`, { cache: "no-store" });
      if (!res.ok) return [];
      const payload = (await res.json()) as ArchivePayload;
      setArchive(payload);

      const seen = new Set(live.map(identityOf));
      const extra: RegWatchItem[] = [];
      ALL_STATES.forEach((key) => {
        (payload[key] ?? []).forEach((raw) => {
          const id = identityOf(raw);
          if (seen.has(id)) return; // the latest run's copy wins
          seen.add(id);
          extra.push({ ...raw, _state: key, _archived: true });
        });
      });
      return extra;
    } catch {
      return [];
    }
  };

  /* Cache-busted, because the dev server and the browser will both happily
   * hand back a stale copy of a file that changed on disk. */
  const loadData = async () => {
    const stamp = Date.now();

    /* Preferred: the three-bucket payload, so the board can show pending
     * review and rejected beside published. Written as regwatch_board.json. */
    try {
      const res = await fetch(`${BOARD_URL}?t=${stamp}`, { cache: "no-store" });
      if (res.ok) {
        const board = (await res.json()) as BoardPayload;
        const flat: RegWatchItem[] = [];
        ALL_STATES.forEach((key) => {
          const bucket = board[key] ?? [];
          bucket.forEach((raw) => {
            flat.push({
              ...raw,
              _state: key,
              _fetched: board.generated_at ?? "",
            });
          });
        });

        /* Archive items go after the live ones, so a reference number never
         * changes meaning when a run adds items ahead of them. */
        const older = await loadArchive(stamp, flat);
        const pool = [...flat, ...older].map((item, i) => ({
          ...item,
          _ref: `RW/${String(item.date ?? "").slice(0, 4) || "----"}/${String(
            i + 1,
          ).padStart(5, "0")}`,
        }));
        setItems(sortNewestFirst(pool));
        setBoard(board);
        setGeneratedAt(board.generated_at ?? "");
        setPartial(false);
        await loadMeta(stamp, !board.generated_at);
        return;
      }
    } catch {
      /* fall through to the published-only file */
    }

    /* Fallback: regwatch_latest.json holds published items only. Used until a
     * scrape has written the board file, so the page never goes blank merely
     * because the newer output has not landed yet. */
    const res = await fetch(`${DATA_URL}?t=${stamp}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const rows: RegWatchItem[] = Array.isArray(data) ? data : [data];
    setItems(
      sortNewestFirst(
        rows.map((raw, i) => ({
          ...raw,
          _state: "published" as StateKey,
          _ref: `RW/${String(raw.date ?? "").slice(0, 4) || "----"}/${String(i + 1).padStart(5, "0")}`,
        })),
      ),
    );
    setPartial(true);
    await loadMeta(stamp);
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      await loadData();
      setLoadError(null);
    } catch (err) {
      setLoadError((err as Error).message);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData()
      .catch((err: Error) => setLoadError(err.message))
      .finally(() => setLoading(false));
  }, []);

  /* Poll the small meta file and only pull the payload when the scraper has
   * actually produced a newer run, so an idle tab costs almost nothing. */
  useEffect(() => {
    const timer = window.setInterval(async () => {
      try {
        const res = await fetch(`${META_URL}?t=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) return;
        const m: RegWatchMeta = await res.json();
        if (m.generated_at && m.generated_at !== generatedAt) {
          await refresh();
        }
      } catch {
        /* offline; try again next tick */
      }
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [generatedAt]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenRef(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const needle = query.trim().toLowerCase();

  /* Rejected items are shown on the Triage tab, not on the board. Everything
   * the board and the rail count is drawn from this list; `items` keeps all
   * three states for the Processing, Reports and Triage views. */
  const pipelineItems = useMemo(
    () => items.filter((it) => it._state !== "rejected"),
    [items],
  );
  const rejectedItems = useMemo(
    () => items.filter((it) => it._state === "rejected"),
    [items],
  );

  /* The board is a board of what is NEW. Archived items are in the pool so the
   * date bands can reach them, but they stay out of Approved / published until
   * a band is actually chosen - otherwise opening the page shows three weeks of
   * back-catalogue under a heading that means "look at this now".
   *
   * Choosing any band, including a recent one, is the signal that the reader is
   * asking about a period rather than about today, so the archive joins in. */
  const boardPool = useMemo(
    () => (fDate ? pipelineItems : pipelineItems.filter((it) => !it._archived)),
    [pipelineItems, fDate],
  );

  const visible = useMemo(
    () =>
      boardPool.filter((it) => {
        if (fState && it._state !== fState) return false;
        if (fSector && !asList(it.sectors).includes(fSector)) return false;
        if (fFramework && !asList(it.frameworks).includes(fFramework)) return false;
        if (!inDateWindow(it, fDate)) return false;
        if (fUrgency && (it.urgency || "Low") !== fUrgency) return false;
        if (fTier != null && Number(it.importance_tier ?? 4) !== fTier) return false;
        if (fFlag === "alert" && !it.is_alert) return false;
        if (fFlag === "deadline" && !it.deadline) return false;
        if (
          fFlag === "thin" &&
          !(
            it._state === "published" &&
            ((it.nature || "").trim() === "Other" ||
              (asList(it.sectors).length === 0 && asList(it.keywords).length === 0))
          )
        ) {
          return false;
        }
        if (
          fFlag === "capped" &&
          !(jurisdictionOf(it) === "Third country / international" && !euNexusOf(it))
        ) {
          return false;
        }
        if (needle) {
          const hay = [
            it.title,
            it.title_original,
            it.summary,
            it.why_kept,
            it.actions,
            it.source,
            it.source_category,
            it.nature,
            it._ref,
            ...asList(it.frameworks),
            ...asList(it.sectors),
            ...asList(it.keywords),
            ...asList(it.document_families),
            ...asList(it.cssf_themes),
          ]
            .join(" ")
            .toLowerCase();
          if (!hay.includes(needle)) return false;
        }
        return true;
      }),
    [boardPool, fState, fSector, fFramework, fUrgency, fTier, fFlag, fDate, needle],
  );

  const grouped = useMemo(() => {
    const def = GROUPS[group] ?? GROUPS.state;
    const map = new Map<string, RegWatchItem[]>();
    visible.forEach((it) => {
      const key = def.of(it);
      const bucket = map.get(key);
      if (bucket) bucket.push(it);
      else map.set(key, [it]);
    });
    let order = Array.from(map.keys());
    if (group === "state") {
      order = STATES.map((s) => s.label).filter((l) => map.has(l));
    } else {
      order.sort((a, b) => (map.get(b)?.length ?? 0) - (map.get(a)?.length ?? 0));
    }
    return { order, map };
  }, [visible, group]);

  /* Rail counts describe the pool the board is drawing from, so a number in
   * the rail and the number of cards you get by clicking it are the same. */
  const countIf = (pred: (i: RegWatchItem) => boolean) =>
    boardPool.filter(pred).length;

  /* The one exception. A date band counts over EVERY item including the
   * archive, because clicking it is what brings the archive in - a band that
   * reported 0 while holding twelve archived items would hide the only door
   * to them. */
  const countDate = (key: string) =>
    pipelineItems.filter((i) => inDateWindow(i, key)).length;

  /* Built from the run, not hard-coded: a sector nobody published this week
   * should not sit in the rail with a zero beside it, and a sector added to
   * the taxonomy later needs no front-end change to appear. */
  const sectorOptions = useMemo(() => {
    const tally = new Map<string, number>();
    boardPool.forEach((it) =>
      asList(it.sectors).forEach((sector) =>
        tally.set(sector, (tally.get(sector) ?? 0) + 1),
      ),
    );
    return Array.from(tally.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [boardPool]);

  const frameworkOptions = useMemo(() => {
    const tally = new Map<string, number>();
    boardPool.forEach((it) =>
      asList(it.frameworks).forEach((framework) =>
        tally.set(framework, (tally.get(framework) ?? 0) + 1),
      ),
    );
    return Array.from(tally.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [boardPool]);

  const found = openRef ? visible.find((i) => i._ref === openRef) : undefined;
  const record = found ?? null;
  const recordPos = record ? visible.indexOf(record) : -1;

  const open = (item: RegWatchItem) => {
    setOpenRef(item._ref ?? null);
    setTab("content");
    window.scrollTo(0, 0);
  };

  const step = (delta: number) => {
    const next = visible[recordPos + delta];
    if (next) {
      setOpenRef(next._ref ?? null);
      setTab("content");
    }
  };

  const activeFilters =
    (fState ? 1 : 0) +
    (fSector ? 1 : 0) +
    (fFramework ? 1 : 0) +
    (fUrgency ? 1 : 0) +
    (fTier != null ? 1 : 0) +
    (fFlag ? 1 : 0) +
    (fDate ? 1 : 0) +
    (query.trim() ? 1 : 0);

  const clearAll = () => {
    setFState(null);
    setFSector(null);
    setFFramework(null);
    setFUrgency(null);
    setFTier(null);
    setFFlag(null);
    setFDate(null);
    setQuery("");
    setOpenRef(null);
  };

  return (
    <div className="min-h-screen bg-background">
      <TopBar />

      {/* Module bar */}
      <div className="border-b border-border bg-card">
        <div className="mx-auto flex h-12 max-w-[1600px] items-center gap-5 px-4 sm:px-6">
          <span className="inline-flex items-center gap-2 font-bold tracking-tight">
            <Scale className="h-4 w-4 text-brand-ink" />
            RegWatch
          </span>
          <nav className="flex h-full items-stretch gap-0.5 text-sm" role="tablist">
            {MODULE_TABS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={moduleTab === key}
                onClick={() => {
                  setModuleTab(key);
                  setOpenRef(null);
                }}
                className={cn(
                  "inline-flex items-center border-b-2 px-3 transition-colors",
                  moduleTab === key
                    ? "border-brand font-semibold text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
                {key === "triage" && rejectedItems.length > 0 ? (
                  <span
                    className={cn(
                      "ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                      moduleTab === "triage"
                        ? "bg-secondary text-foreground"
                        : "bg-secondary text-muted-foreground",
                    )}
                  >
                    {rejectedItems.length}
                  </span>
                ) : null}
              </button>
            ))}
          </nav>
          <span className="ml-auto hidden text-[13px] text-muted-foreground sm:inline">
            regwatch_bot
            {generatedAt ? ` · run ${fmtStamp(generatedAt)}` : ""}
            {meta?.tagged_by_llm != null ? ` · ${meta.tagged_by_llm} tagged by model` : ""}
          </span>
        </div>
      </div>

      {/* Control bar. The search, view toggle and Clear belong to the item
          pipeline; the other module tabs are read-only views over the run. */}
      <div className="border-b border-border bg-card">
        <div
          className={cn(
            "mx-auto flex max-w-[1600px] flex-wrap items-center gap-3 px-4 py-2.5 sm:px-6",
            moduleTab !== "pipeline" && "hidden",
          )}
        >
          <button
            type="button"
            title="A manual-entry form goes here"
            className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-brand-foreground hover:bg-brand-hover"
          >
            <Plus className="h-4 w-4" />
            New
          </button>

          <span className="flex items-baseline gap-2 text-[13px] text-muted-foreground">
            {record ? (
              <button
                type="button"
                onClick={() => setOpenRef(null)}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs hover:bg-secondary hover:text-foreground"
              >
                <ArrowLeft className="h-3 w-3" />
                Items
              </button>
            ) : null}
            <b className="font-semibold text-foreground">Items</b>
            {record ? (
              <span className="flex min-w-0 items-baseline gap-2">
                <span>/</span>
                <span className="max-w-[34ch] truncate font-medium text-foreground">
                  {record.title}
                </span>
                <span className="shrink-0 tabular-nums">{record._ref}</span>
              </span>
            ) : null}
          </span>

          <label className="flex min-w-0 flex-1 basis-64 justify-center">
            <span className="relative w-full max-w-lg">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setOpenRef(null);
                }}
                placeholder="Search titles, summaries, tags, sources…"
                className="w-full rounded-md border border-input bg-background py-1.5 pl-9 pr-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </span>
          </label>

          {record ? (
            <span className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => step(-1)}
                disabled={recordPos <= 0}
                className="rounded-md border border-border px-1.5 py-1 text-muted-foreground hover:bg-secondary disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-xs tabular-nums text-muted-foreground">
                {recordPos + 1} / {visible.length}
              </span>
              <button
                type="button"
                onClick={() => step(1)}
                disabled={recordPos >= visible.length - 1}
                className="rounded-md border border-border px-1.5 py-1 text-muted-foreground hover:bg-secondary disabled:opacity-40"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </span>
          ) : (
            <span className="flex overflow-hidden rounded-md border border-border">
              <button
                type="button"
                onClick={() => setView("board")}
                aria-selected={view === "board"}
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px]",
                  view === "board"
                    ? "bg-primary text-primary-foreground"
                    : "bg-card text-muted-foreground hover:bg-secondary",
                )}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                Board
              </button>
              <button
                type="button"
                onClick={() => setView("list")}
                aria-selected={view === "list"}
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px]",
                  view === "list"
                    ? "bg-primary text-primary-foreground"
                    : "bg-card text-muted-foreground hover:bg-secondary",
                )}
              >
                <ListIcon className="h-3.5 w-3.5" />
                List
              </button>
            </span>
          )}

          <span className="text-xs tabular-nums text-muted-foreground">
            {visible.length} of {items.length} items
          </span>

          <button
            type="button"
            onClick={clearAll}
            disabled={activeFilters === 0}
            title={
              activeFilters === 0
                ? "No filters are active"
                : `Clear ${activeFilters} active filter${activeFilters === 1 ? "" : "s"}`
            }
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[13px] text-muted-foreground enabled:hover:border-primary enabled:hover:text-foreground disabled:opacity-40"
          >
            <X className="h-3.5 w-3.5" />
            Clear
            {activeFilters > 0 ? (
              <span className="grid h-4 min-w-4 place-items-center rounded-full bg-brand px-1 text-[10px] font-bold tabular-nums text-brand-foreground">
                {activeFilters}
              </span>
            ) : null}
          </button>

          <button
            type="button"
            onClick={refresh}
            title="Reload now"
            className="rounded-md border border-border p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
          </button>
        </div>
      </div>

      {moduleTab !== "pipeline" ? (
        <div className="border-b border-border bg-card">
          <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3 px-4 py-2.5 sm:px-6">
            <b className="text-[13px] font-semibold text-foreground">
              {MODULE_TABS.find(([k]) => k === moduleTab)?.[1]}
            </b>
            <span className="text-xs text-muted-foreground">
              {generatedAt ? `run of ${fmtStamp(generatedAt)}` : "no run loaded"}
            </span>
            <span className="ml-auto" />
            <button
              type="button"
              onClick={refresh}
              title="Reload now"
              className="rounded-md border border-border p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            </button>
          </div>
        </div>
      ) : null}

      {partial && !loading ? (
        <div className="border-b border-warning/40 bg-warning/10 px-4 py-2 text-[13px] text-warning sm:px-6">
          Showing published items only — <code>regwatch_board.json</code> has not been written yet.
          The pending-review column and the Triage tab fill in after the next scrape.
        </div>
      ) : null}

      {loadError ? (
        <div className="border-b border-brand/40 bg-brand/10 px-4 py-2 text-[13px] text-brand-ink sm:px-6">
          Could not load the scrape output ({loadError}). Check that the scraper has run and written
          into <code>front-end/public</code>.
        </div>
      ) : null}

      {moduleTab !== "pipeline" ? (
        <main className="mx-auto max-w-[1600px] px-4 pb-20 pt-5 sm:px-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading the latest run…</p>
          ) : moduleTab === "processing" ? (
            <ProcessingView board={board} meta={meta} items={items} />
          ) : moduleTab === "reports" ? (
            <ReportsView items={items} />
          ) : moduleTab === "sources" ? (
            <SourcesView board={board} />
          ) : moduleTab === "triage" ? (
            <TriageView items={rejectedItems} />
          ) : (
            <ConfigurationView meta={meta} />
          )}
        </main>
      ) : null}

      <div
        className={cn(
          "mx-auto grid max-w-[1600px] grid-cols-1 md:grid-cols-[232px_minmax(0,1fr)]",
          moduleTab !== "pipeline" && "hidden",
        )}
      >
        {/* ---------------- rail ---------------- */}
        <aside className="hidden border-r border-border bg-surface px-3 pb-16 pt-4 md:block">
          <RailSection
            title="State"
            options={STATES.length}
            active={fState ? stateLabel(fState) : null}
            defaultOpen
          >
            {STATES.map((st) => (
              <RailOption
                key={st.key}
                label={st.label}
                count={countIf((i) => i._state === st.key)}
                active={fState === st.key}
                onClick={() => setFState(fState === st.key ? null : st.key)}
              />
            ))}
          </RailSection>

          {sectorOptions.length ? (
            <RailSection
              title="Sector"
              options={sectorOptions.length}
              active={fSector}
              defaultOpen
            >
              {sectorOptions.map(([sector, n]) => (
                <RailOption
                  key={sector}
                  label={sector}
                  count={n}
                  active={fSector === sector}
                  onClick={() => setFSector(fSector === sector ? null : sector)}
                />
              ))}
            </RailSection>
          ) : null}

          {frameworkOptions.length ? (
            <RailSection
              title="Framework"
              options={frameworkOptions.length}
              active={fFramework}
            >
              {frameworkOptions.map(([framework, n]) => (
                <RailOption
                  key={framework}
                  label={framework}
                  count={n}
                  active={fFramework === framework}
                  onClick={() =>
                    setFFramework(fFramework === framework ? null : framework)
                  }
                />
              ))}
            </RailSection>
          ) : null}

          <RailSection title="Urgency" options={3} active={fUrgency}>
          {["High", "Medium", "Low"].map((lv) => (
            <RailOption
              key={lv}
              label={lv}
              count={countIf((i) => (i.urgency || "Low") === lv)}
              active={fUrgency === lv}
              onClick={() => setFUrgency(fUrgency === lv ? null : lv)}
            />
          ))}
          </RailSection>

          <RailSection
            title="Importance tier"
            options={4}
            active={fTier != null ? `Tier ${fTier}` : null}
          >
          {[1, 2, 3, 4].map((n) => {
            const sample = items.find(
              (i) => Number(i.importance_tier) === n && i.importance_label,
            );
            const label = sample?.importance_label
              ? `Tier ${n} · ${sample.importance_label}`
              : `Tier ${n}`;
            return (
              <RailOption
                key={n}
                label={label}
                count={countIf((i) => Number(i.importance_tier ?? 4) === n)}
                active={fTier === n}
                onClick={() => setFTier(fTier === n ? null : n)}
              />
            );
          })}
          </RailSection>

          <RailSection title="Flags" options={4} active={fFlag}>
          <RailOption
            label="Action required"
            count={countIf((i) => !!i.is_alert)}
            active={fFlag === "alert"}
            onClick={() => setFFlag(fFlag === "alert" ? null : "alert")}
          />
          <RailOption
            label="Has a deadline"
            count={countIf((i) => !!i.deadline)}
            active={fFlag === "deadline"}
            onClick={() => setFFlag(fFlag === "deadline" ? null : "deadline")}
          />
          <RailOption
            label="Thin tagging"
            count={countIf(
              (i) =>
                i._state === "published" &&
                ((i.nature || "").trim() === "Other" ||
                  (asList(i.sectors).length === 0 && asList(i.keywords).length === 0)),
            )}
            active={fFlag === "thin"}
            onClick={() => setFFlag(fFlag === "thin" ? null : "thin")}
          />
          <RailOption
            label="Capped, no EU nexus"
            count={countIf(
              (i) => jurisdictionOf(i) === "Third country / international" && !euNexusOf(i),
            )}
            active={fFlag === "capped"}
            onClick={() => setFFlag(fFlag === "capped" ? null : "capped")}
          />
          </RailSection>

          <RailSection
            title="Publication date"
            options={DATE_WINDOWS.length}
            active={fDate ? DATE_WINDOWS.find((w) => w.key === fDate)?.label ?? fDate : null}
            defaultOpen
          >
          {DATE_WINDOWS.map((w) => (
            <RailOption
              key={w.key}
              label={w.label}
              count={countDate(w.key)}
              active={fDate === w.key}
              onClick={() => setFDate(fDate === w.key ? null : w.key)}
            />
          ))}
          {/* An empty band needs a reason, or it reads as "the regulator
            * published nothing for a year". It means the opposite: RegWatch
            * has not been collecting that long. This says how far back the
            * data actually goes, in one line, next to the bands it explains. */}
          <p className="px-1 pt-2 text-[11px] leading-snug text-muted-foreground">
            {archive?.covers_from ? (
              <>
                The board shows this run only. Pick a band to search the archive
                back to{" "}
                <span className="tabular-nums">{archive.covers_from}</span>
                {typeof archive.runs_merged === "number"
                  ? ` (${archive.runs_merged} runs)`
                  : ""}
                . A band older than that is empty because nothing older has been
                collected yet — not because nothing was published.
              </>
            ) : (
              <>
                Only the latest run is loaded, so anything older than its window
                reads zero. Run <code>python build_archive.py</code> to merge the
                past runs in.
              </>
            )}
          </p>
          </RailSection>

          <RailSection
            title="Group by"
            options={Object.keys(GROUPS).length}
            active={group !== "state" ? GROUPS[group]?.label : null}
          >
          {Object.keys(GROUPS).map((key) => (
            <RailOption
              key={key}
              label={GROUPS[key].label}
              active={group === key}
              onClick={() => setGroup(key)}
            />
          ))}
          </RailSection>

          {/* The clear button lives in the control bar at the top, next to the
              item count, where it is visible without scrolling the rail. */}
        </aside>

        {/* ---------------- main ---------------- */}
        <main className="min-w-0 px-4 pb-20 pt-4 sm:px-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading the latest scrape…</p>
          ) : record ? (
            <Record
              item={record}
              tab={tab}
              setTab={setTab}
              generatedAt={generatedAt}
              onPickTag={(v) => {
                setQuery(v);
                setOpenRef(null);
              }}
            />
          ) : visible.length === 0 ? (
            <p className="text-sm italic text-muted-foreground">Nothing matches those filters.</p>
          ) : view === "board" ? (
            <div className="flex items-start gap-3 overflow-x-auto pb-4">
              {grouped.order.map((key) => {
                const bucket = grouped.map.get(key) ?? [];
                const st = STATES.find((s) => s.label === key);
                return (
                  <section
                    key={key}
                    className="w-[300px] shrink-0 rounded-xl bg-secondary/60 p-2.5"
                  >
                    <header className="flex items-baseline gap-2 px-1 pb-2 text-[13px] font-semibold">
                      <span
                        className={cn(
                          "h-2 w-2 shrink-0 rounded-sm",
                          st ? st.dot : "bg-primary",
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate">{key}</span>
                      <span className="font-normal tabular-nums text-muted-foreground">
                        {bucket.length}
                      </span>
                    </header>
                    {(expanded.includes(key) ? bucket : bucket.slice(0, BOARD_PAGE)).map(
                      (it) => (
                        <BoardCard key={it._ref} item={it} onOpen={() => open(it)} />
                      ),
                    )}
                    {bucket.length > BOARD_PAGE ? (
                      <button
                        type="button"
                        onClick={() =>
                          setExpanded((prev) =>
                            prev.includes(key)
                              ? prev.filter((k) => k !== key)
                              : [...prev, key],
                          )
                        }
                        className="mt-1 w-full rounded-md border border-border bg-card py-1.5 text-xs font-medium text-muted-foreground hover:border-primary hover:text-foreground"
                      >
                        {expanded.includes(key)
                          ? `Show the first ${BOARD_PAGE}`
                          : `Show all ${bucket.length} — ${bucket.length - BOARD_PAGE} more`}
                      </button>
                    ) : null}
                  </section>
                );
              })}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-[13.5px]">
                <thead>
                  <tr>
                    {[
                      "Reference",
                      "Title",
                      "Source",
                      "Type",
                      "Urgency",
                      "Tier",
                      "Published",
                      "Due",
                    ].map((h) => (
                      <th
                        key={h}
                        className="border-b border-border pb-2 pr-3 text-left text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grouped.order.map((key) => {
                    const bucket = grouped.map.get(key) ?? [];
                    return (
                      <Fragment key={key}>
                        <tr className="bg-secondary/70">
                          <td colSpan={8} className="py-1.5 pr-3 text-[12.5px] font-semibold">
                            {key} · {bucket.length}
                          </td>
                        </tr>
                        {bucket.map((it) => (
                          <tr
                            key={it._ref}
                            onClick={() => open(it)}
                            className="cursor-pointer border-b border-border hover:bg-secondary/60"
                          >
                            <td className="py-2 pr-3 align-top tabular-nums text-muted-foreground">
                              {it._ref}
                            </td>
                            <td className="py-2 pr-3 align-top font-medium">{it.title}</td>
                            <td className="py-2 pr-3 align-top text-muted-foreground">
                              {it.source}
                            </td>
                            <td className="py-2 pr-3 align-top text-muted-foreground">
                              {it.nature || "Other"}
                            </td>
                            <td className="py-2 pr-3 align-top text-muted-foreground">
                              {it.urgency || "Low"}
                            </td>
                            <td className="py-2 pr-3 align-top tabular-nums text-muted-foreground">
                              {Number(it.importance_tier ?? 4)}
                            </td>
                            <td className="py-2 pr-3 align-top tabular-nums text-muted-foreground">
                              {fmtDate(it.date)}
                            </td>
                            <td className="py-2 pr-3 align-top tabular-nums text-muted-foreground">
                              {fmtDate(it.deadline)}
                            </td>
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Rejected items are one click away, not hidden. Reading the reject
              list is how you tell a working gate from an over-strict one, so
              it has to stay discoverable from the board. */}
          {rejectedItems.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                setModuleTab("triage");
                setOpenRef(null);
                window.scrollTo(0, 0);
              }}
              className="mt-6 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
            >
              {rejectedItems.length} filtered out of scope
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </main>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Board card
 * ------------------------------------------------------------------ */
function BoardCard({ item, onOpen }: { item: RegWatchItem; onOpen: () => void }) {
  const due = daysUntil(item.deadline);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "mb-2 block w-full rounded-lg border border-border bg-card p-2.5 text-left transition-colors hover:border-primary",
        item.is_alert && "border-l-[3px] border-l-brand",
      )}
    >
      <h4 className="text-[13.5px] font-semibold leading-snug">{item.title}</h4>
      <p className="mt-1 text-[11.5px] text-muted-foreground">
        {item.source}
        {item.source_category && item.source_category !== item.source
          ? ` — ${item.source_category}`
          : ""}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <TierPill item={item} />
        <Pill>{item.nature || "Other"}</Pill>
        <Pill className={URGENCY_PILL[item.urgency || "Low"]}>{item.urgency || "Low"}</Pill>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11.5px] text-muted-foreground">
        <span className="tabular-nums">{fmtDate(item.date)}</span>
        {daysSincePublication(item) === 0 ? (
          <span className="rounded-full bg-brand px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-brand-foreground">
            today
          </span>
        ) : null}
        {isUpcoming(item) ? (
          <span className="rounded-full border border-border px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide">
            upcoming
          </span>
        ) : null}
        {/* From a previous run, not this morning's. Worth saying on the card:
          * the older date bands are made almost entirely of these, and an
          * archived record must never be quoted as current. */}
        {item._archived ? (
          <span className="rounded-full border border-border px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide">
            {item._legacy ? "archive · untagged" : "archive"}
          </span>
        ) : null}
        {item.deadline ? (
          <span className="font-semibold text-brand-ink">
            Due: {fmtDate(item.deadline)}
            {due != null && due < 90 ? ` (${due}d)` : ""}
          </span>
        ) : null}
      </div>
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * The record
 * ------------------------------------------------------------------ */
function SectionHead({ n, title }: { n: number; title: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded bg-primary text-[11px] font-bold text-primary-foreground">
        {n}
      </span>
      <h4 className="shrink-0 text-[11.5px] font-semibold uppercase tracking-[0.09em] text-secondary-foreground">
        {title}
      </h4>
      {/* The rule runs to the edge, the way a section divider does in the
          module this layout follows. */}
      <span aria-hidden="true" className="ml-1 h-px flex-1 bg-border" />
    </div>
  );
}

function Record({
  item,
  tab,
  setTab,
  generatedAt,
  onPickTag,
}: {
  item: RegWatchItem;
  tab: string;
  setTab: (t: string) => void;
  generatedAt: string;
  onPickTag: (value: string) => void;
}) {
  const pass = item._state !== "rejected";
  const fetched = item._fetched || generatedAt;
  const jurisdiction = jurisdictionOf(item);
  const nexus = euNexusOf(item);
  const derived = !item.jurisdiction && !!jurisdiction;
  const capped = jurisdiction === "Third country / international" && !nexus;

  const tabs: [string, string][] = [
    ["content", "Content"],
    ["source", "Source"],
    ["triage", "Triage & Classification"],
    ["analysis", "Analysis"],
    ["quality", "Quality Review"],
    ["logs", "Process logs"],
    ["debug", "Debug"],
  ];

  /* Two ways an item can satisfy the gate while telling you very little.
   * Neither changes whether it publishes - they are shown so a reader can see
   * WHICH items got through on thin evidence. Measured on the run of
   * 31 August 2026: 10 of 24 published items carry the type "Other". */
  const placeholderType = (item.nature || "").trim() === "Other";
  const thinTags =
    asList(item.sectors).length === 0 && asList(item.keywords).length === 0;

  /* What the gate required and whether this item supplied it. These are the
   * actual conditions in apply_gate(), not a decorative checklist. */
  const gateChecks: [string, boolean, string][] = [
    [
      "Judged relevant to the financial sector",
      item._state !== "rejected",
      "Rejected items never reach the rest of the gate.",
    ],
    [
      "Has a regulation type",
      !!(item.nature && item.nature !== ""),
      "REQUIRE_REGULATION_TYPE_TO_PUBLISH — without it the item waits for a human.",
    ],
    [
      "Has a framework or an in-scope sector",
      asList(item.frameworks).length > 0 || asList(item.sectors).length > 0,
      "REQUIRE_FRAMEWORK_OR_SECTOR_TO_PUBLISH — one of the two is enough.",
    ],
    [
      "EU or Luxembourg nexus",
      jurisdictionOf(item) !== "Third country / international" || euNexusOf(item),
      "Third-country publications need a stated nexus before they can publish.",
    ],
  ];

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="px-5 pb-2 pt-5">
        <p className="text-[11px] uppercase tracking-[0.09em] text-muted-foreground">Title</p>
        <h2 className="mt-1 text-lg font-semibold leading-snug">{item.title}</h2>
        {item.title_original && item.title_original !== item.title ? (
          <p className="mt-1.5 text-[12.5px] italic text-muted-foreground">
            Original: {item.title_original}
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-x-10 px-5 pb-4 lg:grid-cols-2">
        <dl>
          <Field label="Source">{item.source}</Field>
          <Field label="Source Url">
            {item.link ? (
              <a
                href={item.link}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
              >
                {item.link.slice(0, 58)}
                {item.link.length > 58 ? "…" : ""}
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
          </Field>
          <Field label="Published Date">{fmtDate(item.date)}</Field>
          <Field label="Fetched Date" help="The scrape run that collected this item">
            {fmtStamp(fetched)}
          </Field>
        </dl>
        <dl>
          <Field label="Category">{item.source_category}</Field>
          <Field label="Created By User">regwatch_bot</Field>
          <Field
            label="Reference"
            help="Derived in this view from the publication year and position — the scraper does not store one yet"
          >
            {item._ref}
          </Field>
          <Field
            label="Language"
            help={item.language ? undefined : "Guessed from the original title"}
          >
            {guessLanguage(item)}
          </Field>
          <Field
            label="Jurisdiction"
            help={
              derived
                ? "Decided from the source. This run predates the rule, so the value is derived in the page — it will come from the scraper after the next scrape."
                : "Decided from the source, not from the text"
            }
          >
            {jurisdiction ? (
              <span className="inline-flex flex-wrap items-center gap-1.5">
                {jurisdiction}
                {capped ? <Pill className="border-brand/45 text-brand-ink">no EU nexus</Pill> : null}
                {derived ? (
                  <span className="text-xs text-muted-foreground">derived</span>
                ) : null}
              </span>
            ) : null}
          </Field>
        </dl>
      </div>

      <div className="flex flex-wrap gap-0.5 border-b border-border px-3">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            aria-selected={tab === key}
            className={cn(
              "-mb-px border-b-2 px-3 py-2.5 text-sm",
              tab === key
                ? "border-brand font-semibold text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="px-5 pb-6 pt-4">
        {tab === "content" ? (
          <div className="max-w-[78ch] text-[14px] leading-relaxed text-muted-foreground">
            <h5 className="mb-1.5 text-[11px] uppercase tracking-[0.09em] text-muted-foreground">
              Summary
            </h5>
            <p>
              {item.summary ? (
                item.summary
              ) : (
                <span className="italic">
                  {item._state === "rejected"
                    ? "Not written: triage stops before enrichment, so an out-of-scope item is never summarised."
                    : "No summary."}
                </span>
              )}
            </p>
            {item.actions ? (
              <>
                <h5 className="mb-1.5 mt-5 text-[11px] uppercase tracking-[0.09em] text-muted-foreground">
                  Recommended action
                </h5>
                <p>{item.actions}</p>
              </>
            ) : null}
            {item.why_kept ? (
              <>
                <h5 className="mb-1.5 mt-5 text-[11px] uppercase tracking-[0.09em] text-muted-foreground">
                  Why this was kept
                </h5>
                <p>{item.why_kept}</p>
              </>
            ) : null}
          </div>
        ) : null}

        {tab === "source" ? (
          <div className="grid grid-cols-1 gap-x-10 lg:grid-cols-2">
            <dl>
              <Field label="Source name">{item.source}</Field>
              <Field label="Source code">
                <code className="rounded bg-secondary px-1 py-0.5 text-xs">{item.source_code}</code>
              </Field>
              <Field label="Category">{item.source_category}</Field>
              <Field label="Geography">{item.geo}</Field>
            </dl>
            <dl>
              <Field
                label="Also reported by"
                help="Other sources that carried the same item; merged during deduplication"
              >
                <Chips values={item.also_from} />
              </Field>
              <Field label="CSSF themes" help="Which CSSF keyword slices matched">
                <Chips values={item.cssf_themes} />
              </Field>
              <Field label="Duplicate copies">{String(item.duplicate_copies ?? 0)}</Field>
            </dl>
          </div>
        ) : null}

        {tab === "triage" ? (
          <>
            <SectionHead n={1} title="Triage" />
            <div className="grid grid-cols-1 gap-x-10 lg:grid-cols-2">
              <dl>
                <Field label="Triage decision">
                  {pass ? (
                    <Pill className="border-success/50 text-success">Pass</Pill>
                  ) : (
                    <Pill className="border-brand/45 text-brand-ink">Fail — out of scope</Pill>
                  )}
                </Field>
                <Field label="Triage date">{fmtStamp(fetched)}</Field>
                <Field label="Decided by">
                  {item.tagged_by === "llm" ? "Model" : "Keyword fallback"}
                </Field>
                <Field
                  label="State reason"
                  emptyNote={
                    item._state === "published"
                      ? "passed the gate with no exception"
                      : "not recorded"
                  }
                >
                  {item.state_reason}
                </Field>
              </dl>
              <dl>
                <Field label="Keywords">
                  <Chips values={item.keywords} onPick={onPickTag} />
                </Field>
                <Field
                  label="EU / LU nexus"
                  help="Does the text state a connection to the EU, the euro area or Luxembourg?"
                >
                  {jurisdiction ? (nexus ? "Yes" : "No") : null}
                </Field>
              </dl>
            </div>
            {item.why_kept ? (
              <p className="mt-3 text-[13px] leading-relaxed text-secondary-foreground">
                {item.why_kept}
              </p>
            ) : null}

            <div className="h-5" />
            <SectionHead n={2} title="Classification" />
            <div className="grid grid-cols-1 gap-x-10 lg:grid-cols-2">
              <dl>
                <Field label="Regulation type">{item.nature || "Other"}</Field>
                <Field label="Issuing body">{item.source}</Field>
                <Field
                  label="Item ref"
                  help="Derived here; the scraper does not parse document reference codes yet"
                >
                  {item._ref}
                </Field>
                <Field label="Urgency">
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    <Pill className={URGENCY_PILL[item.urgency || "Low"]}>
                      {item.urgency || "Low"}
                    </Pill>
                    {item.urgency_uncapped ? (
                      <span className="text-xs text-muted-foreground">
                        capped from {item.urgency_uncapped}
                      </span>
                    ) : null}
                  </span>
                </Field>
                <Field label="Frameworks">
                  <Chips values={item.frameworks} onPick={onPickTag} />
                </Field>
                <Field label="In-scope sectors">
                  <Chips values={item.sectors} onPick={onPickTag} />
                </Field>
                <Field label="Entities">
                  <Chips values={item.entities} onPick={onPickTag} />
                </Field>
              </dl>
              <dl>
                <Field label="Due date" emptyNote="none stated in the text">
                  {fmtDate(item.deadline)}
                </Field>
                <Field label="Action required">
                  {/* Read-only on purpose: this page has no write API, so a
                      checkbox you could tick would be lying about what it does. */}
                  <input
                    type="checkbox"
                    checked={!!item.is_alert}
                    aria-label="Action required"
                    aria-readonly="true"
                    onClick={(e) => e.preventDefault()}
                    onKeyDown={(e) => e.preventDefault()}
                    className="h-4 w-4 cursor-default accent-[var(--brand)]"
                  />
                </Field>
                <Field label="Action deadline" emptyNote="none stated in the text">
                  {fmtDate(item.deadline)}
                </Field>
                <Field label="Tags">
                  <Chips
                    values={[...asList(item.document_families), ...asList(item.asset_classes)]}
                  />
                </Field>
              </dl>
            </div>
          </>
        ) : null}

        {tab === "analysis" ? (
          <div className="grid grid-cols-1 gap-x-10 lg:grid-cols-2">
            <dl>
              <Field label="Importance tier">
                <span className="inline-flex flex-wrap items-center gap-2">
                  <TierPill item={item} />
                  <span>{item.importance_label}</span>
                  {item.tier_uncapped != null &&
                  Number(item.tier_uncapped) !== Number(item.importance_tier) ? (
                    <span className="text-xs text-muted-foreground">
                      capped from tier {item.tier_uncapped}
                    </span>
                  ) : null}
                </span>
              </Field>
              <Field
                label="Legal level"
                help="Position in the 14-level legal hierarchy"
                emptyNote="not placed — the document type maps to no level"
              >
                {item.legal_level == null
                  ? null
                  : `${item.legal_level} — ${item.legal_level_label ?? ""}`}
              </Field>
              <Field label="Niveau juridique">{item.legal_level_fr}</Field>
            </dl>
            <dl>
              <Field label="Regulatory force" help="1 = informational, 5 = directly binding">
                <ForceStars force={item.legal_force} />
              </Field>
              <Field
                label="Escalation"
                help="e.g. an ESA guideline that becomes binding once a CSSF circular adopts it"
                emptyNote="none — this text does not gain force through another instrument"
              >
                {item.escalation_note}
              </Field>
              <Field label="Document families">
                <Chips values={item.document_families} />
              </Field>
              <Field label="Asset classes">
                <Chips values={item.asset_classes} />
              </Field>
            </dl>
          </div>
        ) : null}

        {tab === "quality" ? (
          <>
            <SectionHead n={1} title="Gate conditions" />
            <ul className="mb-5 max-w-[80ch] space-y-2">
              {gateChecks.map(([label, ok, why]) => (
                <li key={label} className="flex items-start gap-2.5 text-[13px]">
                  <span
                    className={cn(
                      "mt-[3px] grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white",
                      ok ? "bg-success" : "bg-warning",
                    )}
                  >
                    {ok ? "✓" : "!"}
                  </span>
                  <span className="min-w-0">
                    <span className={ok ? "text-foreground" : "font-medium text-warning"}>
                      {label}
                    </span>
                    <span className="ml-2 text-muted-foreground">{why}</span>
                  </span>
                </li>
              ))}
            </ul>

            {placeholderType || thinTags ? (
              <>
                <SectionHead n={2} title="Weak evidence" />
                <ul className="mb-5 max-w-[80ch] space-y-2">
                  {placeholderType ? (
                    <li className="flex items-start gap-2.5 text-[13px]">
                      <span className="mt-[3px] grid h-4 w-4 shrink-0 place-items-center rounded-full bg-warning text-[10px] font-bold text-white">
                        !
                      </span>
                      <span>
                        <span className="font-medium text-warning">
                          Regulation type is “Other”
                        </span>
                        <span className="ml-2 text-muted-foreground">
                          It says nothing about what the document is, so the gate requires
                          an in-scope sector and at least one keyword before an item typed
                          this way can publish. The label is missing, not the relevance.
                        </span>
                      </span>
                    </li>
                  ) : null}
                  {thinTags ? (
                    <li className="flex items-start gap-2.5 text-[13px]">
                      <span className="mt-[3px] grid h-4 w-4 shrink-0 place-items-center rounded-full bg-warning text-[10px] font-bold text-white">
                        !
                      </span>
                      <span>
                        <span className="font-medium text-warning">
                          No in-scope sector and no keywords
                        </span>
                        <span className="ml-2 text-muted-foreground">
                          A single framework tag carried this item through. Worth a human
                          look before it counts as regulatory news.
                        </span>
                      </span>
                    </li>
                  ) : null}
                </ul>
                <SectionHead n={3} title="Outcome" />
              </>
            ) : (
              <SectionHead n={2} title="Outcome" />
            )}
            <div className="grid grid-cols-1 gap-x-10 lg:grid-cols-2">
              <dl>
                <Field label="State">{stateLabel(item._state)}</Field>
                <Field
                  label="Reason"
                  emptyNote={
                    item._state === "published"
                      ? "passed the gate with no exception"
                      : "not recorded"
                  }
                >
                  {item.state_reason}
                </Field>
                <Field label="Tagged by">
                  {item.tagged_by === "llm" ? "Model" : "Keyword fallback"}
                </Field>
              </dl>
              <dl>
                <Field label="Tier">
                  {item.tier_uncapped != null &&
                  Number(item.tier_uncapped) !== Number(item.importance_tier)
                    ? `${item.importance_tier} (capped from ${item.tier_uncapped})`
                    : String(item.importance_tier ?? "")}
                </Field>
                <Field label="Urgency">
                  {item.urgency_uncapped
                    ? `${item.urgency} (capped from ${item.urgency_uncapped})`
                    : item.urgency || "Low"}
                </Field>
                <Field label="Alert">{item.is_alert ? "Yes" : "No"}</Field>
              </dl>
            </div>
          </>
        ) : null}

        {tab === "logs" ? (
          <div className="max-w-[80ch]">
            <SectionHead n={1} title="Collection" />
            <dl className="mb-5">
              <Field label="Run" help="The scrape that produced this record">
                {fmtStamp(fetched)}
              </Field>
              <Field label="Source feed">
                <code className="rounded bg-secondary px-1 py-0.5 text-xs">
                  {item.source_code}
                </code>
              </Field>
              <Field label="Published">{fmtDate(item.date)}</Field>
            </dl>

            <SectionHead n={2} title="Deduplication" />
            <dl className="mb-5">
              <Field label="Copies seen" help="How many feeds delivered this same item">
                {String((item.duplicate_copies ?? 0) + 1)}
              </Field>
              <Field label="Also reported by">
                <Chips values={item.also_from} />
              </Field>
              <Field
                label="Theme slices"
                help="The CSSF site has no topic categories; these are our own keyword slices"
              >
                <Chips values={item.cssf_themes} />
              </Field>
            </dl>

            <SectionHead n={3} title="Tagging" />
            <dl>
              <Field label="Decided by">
                {item.tagged_by === "llm" ? "Azure OpenAI" : "Keyword fallback"}
              </Field>
              <Field label="Jurisdiction">{jurisdiction}</Field>
              <Field label="Nexus test">
                {jurisdiction ? (nexus ? "Passed" : "Failed") : null}
              </Field>
            </dl>
          </div>
        ) : null}

        {tab === "debug" ? (
          <>
            <div className="grid grid-cols-1 gap-x-10 lg:grid-cols-2">
              <dl>
                <Field label="Pipeline state">{stateLabel(item._state)}</Field>
                <Field label="Tagged by">{item.tagged_by}</Field>
                <Field label="Jurisdiction">{jurisdiction}</Field>
              </dl>
              <dl>
                <Field label="Tier before cap">
                  {item.tier_uncapped == null ? null : String(item.tier_uncapped)}
                </Field>
                <Field label="Urgency before cap">{item.urgency_uncapped}</Field>
                <Field label="Run generated at">{fmtStamp(generatedAt)}</Field>
              </dl>
            </div>
            <pre className="mt-3 overflow-x-auto rounded-lg border border-border bg-background p-3 text-xs leading-relaxed text-muted-foreground">
              {JSON.stringify(item, null, 2)}
            </pre>
          </>
        ) : null}
      </div>
    </div>
  );
}

/* ==================================================================== *
 * The other module tabs.
 *
 * Every number below is counted from the run payload — nothing is stored,
 * assumed or carried over between runs.
 *
 * On charts: these are magnitudes against identities, so they are horizontal
 * bars in ONE hue with the value written out, not a palette of cycled colours.
 * A single-series bar chart needs no categorical palette and no legend — the
 * panel title names the series. The only coloured marks are the three pipeline
 * states, which are status colours and always carry their label.
 * ==================================================================== */

function StatTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "good" | "warn" | "brand";
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="flex items-center gap-2 text-[12px] text-secondary-foreground">
        {tone ? (
          <span
            className={cn(
              "h-2 w-2 shrink-0 rounded-full",
              tone === "good" ? "bg-success" : tone === "warn" ? "bg-warning" : "bg-brand",
            )}
          />
        ) : null}
        {label}
      </p>
      <p className="mt-0.5 text-[30px] font-semibold leading-tight tracking-[-0.02em] tabular-nums">
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-[11.5px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/* One hue, thin marks, value written out, recessive track. */
function BarRow({
  label,
  value,
  max,
  suffix,
}: {
  label: string;
  value: number;
  max: number;
  suffix?: string;
}) {
  const pct = max > 0 ? Math.max(value > 0 ? 1.5 : 0, (value / max) * 100) : 0;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_46px] items-center gap-3 py-[5px]" title={`${label}: ${value}${suffix ?? ""}`}>
      <div className="min-w-0">
        <p className="truncate text-[13px] text-foreground">{label}</p>
        <div className="mt-1 h-[6px] w-full rounded-full bg-secondary">
          <div
            className="h-[6px] rounded-full bg-primary"
            style={{ width: `${pct}%` }}
            aria-hidden="true"
          />
        </div>
      </div>
      <span className="text-right text-[13px] font-semibold tabular-nums text-foreground">
        {value}
        {suffix ?? ""}
      </span>
    </div>
  );
}

function Panel({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h3 className="text-[11.5px] font-semibold uppercase tracking-[0.09em] text-secondary-foreground">
        {title}
      </h3>
      {note ? <p className="mt-1 text-[11.5px] text-muted-foreground">{note}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function tally(items: RegWatchItem[], pick: (i: RegWatchItem) => string[]) {
  const map = new Map<string, number>();
  items.forEach((i) => pick(i).forEach((v) => map.set(v, (map.get(v) ?? 0) + 1)));
  return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
}

function Breakdown({
  title,
  note,
  rows,
  limit,
}: {
  title: string;
  note?: string;
  rows: [string, number][];
  limit?: number;
}) {
  const shown = limit ? rows.slice(0, limit) : rows;
  const max = rows.reduce((m, r) => Math.max(m, r[1]), 0);
  return (
    <Panel title={title} note={note}>
      {shown.length ? (
        <>
          {shown.map(([label, value]) => (
            <BarRow key={label} label={label} value={value} max={max} />
          ))}
          {limit && rows.length > limit ? (
            <p className="mt-2 text-[11.5px] italic text-muted-foreground">
              + {rows.length - limit} more, all visible in the pipeline list grouped the same
              way
            </p>
          ) : null}
        </>
      ) : (
        <p className="text-[13px] italic text-muted-foreground">Nothing to count.</p>
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------------- *
 * Processing — what the run did
 * -------------------------------------------------------------------- */
function ProcessingView({
  board,
  meta,
  items,
}: {
  board: BoardPayload | null;
  meta: RegWatchMeta | null;
  items: RegWatchItem[];
}) {
  const counts = board?.counts ?? meta?.counts ?? {};
  const collected = Number(counts.collected ?? items.length);
  const published = Number(counts.published ?? 0);
  const pending = Number(counts.pending_review ?? 0);
  const rejected = Number(counts.rejected ?? 0);
  const byLlm = board?.tagged_by_llm ?? meta?.tagged_by_llm ?? 0;
  const byKeyword = board?.tagged_by_keyword ?? meta?.tagged_by_keyword ?? 0;
  const duration = meta?.duration_seconds;
  const sources = meta?.sources;
  const problems = (board?.source_problems ?? []) as unknown[];
  const taggingErrors = (board?.tagging_errors ?? []) as unknown[];

  const stages: [string, number, string][] = [
    ["Collected and deduplicated", collected, "items inside the window"],
    ["Tagged", byLlm + byKeyword, `${byLlm} by the model, ${byKeyword} by keyword fallback`],
    ["Published", published, "passed every gate condition"],
    ["Pending review", pending, "relevant, but held for a human"],
    ["Rejected", rejected, "out of scope, with the reason recorded"],
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Collected" value={collected} hint={`${meta?.days_window ?? 7}-day window`} />
        <StatTile label="Published" value={published} hint="on the front end" tone="good" />
        <StatTile label="Pending review" value={pending} hint="needs a human" tone="warn" />
        <StatTile label="Rejected" value={rejected} hint="reason recorded" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel
          title="The run, stage by stage"
          note="Each stage counts what reached it, so the drop between two rows is what that stage removed."
        >
          {stages.map(([label, value, hint]) => (
            <div key={label} className="py-1.5">
              <BarRow label={label} value={value} max={collected} />
              <p className="text-[11.5px] text-muted-foreground">{hint}</p>
            </div>
          ))}
        </Panel>

        <div className="space-y-4">
          <Panel title="Timing and tagging">
            <dl>
              <Field label="Started">{fmtStamp(board?.generated_at ?? meta?.generated_at)}</Field>
              <Field label="Finished">
                {fmtStamp(meta?.finished_at)}
              </Field>
              <Field label="Duration">
                {duration == null ? null : `${Math.floor(duration / 60)} min ${duration % 60} s`}
              </Field>
              <Field label="Tagged by model">{String(byLlm)}</Field>
              <Field
                label="Keyword fallback"
                help="Above zero means the Azure call failed and the pipeline fell back to keyword matching"
                emptyNote="0 — the model tagged everything"
              >
                {byKeyword ? String(byKeyword) : ""}
              </Field>
            </dl>
          </Panel>

          <Panel title="Problems recorded by this run">
            <dl>
              <Field label="Source problems" emptyNote="none">
                {problems.length ? String(problems.length) : ""}
              </Field>
              <Field label="Tagging errors" emptyNote="none">
                {taggingErrors.length ? String(taggingErrors.length) : ""}
              </Field>
              <Field label="Sources producing">
                {sources ? `${sources.producing} of ${sources.total}` : null}
              </Field>
              <Field label="Sources failing">
                {sources ? String(sources.failing) : null}
              </Field>
            </dl>
          </Panel>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- *
 * Reports — the same items, counted every way that matters
 * -------------------------------------------------------------------- */
function ReportsView({ items }: { items: RegWatchItem[] }) {
  const published = items.filter((i) => i._state === "published");

  const byState: [string, number][] = STATES.map((st) => [
    st.label,
    items.filter((i) => i._state === st.key).length,
  ]);
  const byTier = tally(items, (i) => [
    `Tier ${i.importance_tier ?? 4} · ${i.importance_label ?? ""}`.trim(),
  ]).sort((a, b) => a[0].localeCompare(b[0]));
  const byUrgency: [string, number][] = ["High", "Medium", "Low"].map((u) => [
    u,
    items.filter((i) => (i.urgency || "Low") === u).length,
  ]);
  const byJurisdiction = tally(items, (i) => [jurisdictionOf(i) || "Not recorded"]);
  const bySource = tally(items, (i) => [i.source || "—"]);
  const byFramework = tally(items, (i) => asList(i.frameworks));
  const bySector = tally(items, (i) => asList(i.sectors));
  const byType = tally(items, (i) => [i.nature || "(untyped)"]);

  const withDeadline = items.filter((i) => i.deadline);
  const thin = published.filter(
    (i) =>
      (i.nature || "").trim() === "Other" ||
      (asList(i.sectors).length === 0 && asList(i.keywords).length === 0),
  );
  const capped = items.filter(
    (i) => jurisdictionOf(i) === "Third country / international" && !euNexusOf(i),
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="On the front end" value={published.length} tone="good" />
        <StatTile
          label="With a stated deadline"
          value={withDeadline.length}
          hint="the only ones with a date to work back from"
        />
        <StatTile
          label="Thin tagging"
          value={thin.length}
          hint="published on placeholder or minimal tags"
          tone="warn"
        />
        <StatTile
          label="Capped, no EU nexus"
          value={capped.length}
          hint="third-country, no stated EU or LU link"
          tone="brand"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Pipeline state" note="The three buckets the gate sorts into.">
          {byState.map(([label, value]) => {
            const st = STATES.find((x) => x.label === label);
            return (
              <div
                key={label}
                className="flex items-center gap-2.5 py-1.5"
                title={`${label}: ${value}`}
              >
                <span className={cn("h-2 w-2 shrink-0 rounded-full", st?.dot ?? "bg-primary")} />
                <span className="min-w-0 flex-1 truncate text-[13px]">{label}</span>
                <span className="text-[13px] font-semibold tabular-nums">{value}</span>
              </div>
            );
          })}
        </Panel>
        <Breakdown title="Urgency" rows={byUrgency} />
        <Breakdown title="Importance tier" rows={byTier} />
        <Breakdown
          title="Jurisdiction"
          note="Decided from the source, not from the text."
          rows={byJurisdiction}
        />
        <Breakdown title="Regulation type" rows={byType} limit={10} />
        <Breakdown title="Sources, by volume" rows={bySource} limit={10} />
        <Breakdown
          title="Regulatory frameworks"
          note="An item can carry more than one, so these do not sum to the item count."
          rows={byFramework}
          limit={10}
        />
        <Breakdown
          title="In-scope sectors"
          note="Also multi-valued per item."
          rows={bySector}
          limit={10}
        />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- *
 * Sources — the registry, and which parts of it are working
 * -------------------------------------------------------------------- */
function SourcesView({ board }: { board: BoardPayload | null }) {
  const sources = board?.sources ?? [];
  const producing = sources.filter((x) => (x.items ?? 0) > 0);
  const failing = sources.filter((x) => (x.items ?? 0) === 0 && (x.errors?.length ?? 0) > 0);
  const quiet = sources.filter((x) => (x.items ?? 0) === 0 && (x.errors?.length ?? 0) === 0);

  const groups: [string, SourceHealth[], string][] = [
    ["Producing", producing, "returned dated items in this run"],
    [
      "Failing",
      failing,
      "reachable or not, but the parser found nothing it could date — these need their selectors re-pinned",
    ],
    [
      "Quiet",
      quiet,
      "no error and no items: the feed worked and simply published nothing in the window",
    ],
  ];

  if (!sources.length) {
    return (
      <p className="text-sm italic text-muted-foreground">
        This run recorded no source health. It appears in <code>regwatch_board.json</code> under{" "}
        <code>sources</code>.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Sources in the registry" value={sources.length} />
        <StatTile label="Producing" value={producing.length} tone="good" />
        <StatTile label="Failing" value={failing.length} tone="warn" hint="parser found nothing" />
        <StatTile label="Quiet" value={quiet.length} hint="working, nothing published" />
      </div>

      {groups.map(([title, rows, note]) => (
        <Panel key={title} title={`${title} — ${rows.length}`} note={note}>
          {rows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-[13px]">
                <thead>
                  <tr>
                    {["Source", "Code", "Status", "Items", "Unique", "Duplicates", "Detail"].map(
                      (h) => (
                        <th
                          key={h}
                          className="border-b border-border pb-2 pr-3 text-left text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground"
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((x) => (
                    <tr key={x.code} className="border-b border-border">
                      <td className="py-2 pr-3 align-top font-medium">{x.name}</td>
                      <td className="py-2 pr-3 align-top">
                        <code className="rounded bg-secondary px-1 py-0.5 text-xs">{x.code}</code>
                      </td>
                      <td className="py-2 pr-3 align-top text-muted-foreground">{x.status}</td>
                      <td className="py-2 pr-3 align-top tabular-nums">{x.items ?? 0}</td>
                      <td className="py-2 pr-3 align-top tabular-nums text-muted-foreground">
                        {x.unique_items ?? 0}
                      </td>
                      <td className="py-2 pr-3 align-top tabular-nums text-muted-foreground">
                        {x.duplicate_items ?? 0}
                      </td>
                      <td className="py-2 pr-3 align-top text-muted-foreground">
                        {x.errors?.length ? (
                          <span className="text-warning">{x.errors[0]}</span>
                        ) : (
                          <span className="truncate">
                            {x.endpoints?.[0]?.url ? (
                              <a
                                href={x.endpoints[0].url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-primary underline-offset-2 hover:underline"
                              >
                                {x.endpoints[0].kind ?? "feed"}
                              </a>
                            ) : (
                              "—"
                            )}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-[13px] italic text-muted-foreground">None.</p>
          )}
        </Panel>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------- *
 * Triage — everything the gate rejected, and why
 * -------------------------------------------------------------------- *
 * This is the audit trail, not a work queue. The question it has to answer is
 * "is my gate working, or is it too strict?", and the only field that answers
 * that is the rejection reason. Tier 4 / Other / Low on a rejected item tells
 * you nothing, so those chips are gone.
 *
 * Grouped by SOURCE rather than by reason: the reasons are written by the
 * model and are almost all unique (74 distinct reasons across 77 items on
 * 1 September 2026), so grouping by them produces 74 groups of one. Source
 * groups into a dozen and answers the more useful question - which feed is
 * generating the noise.
 */
function TriageView({ items }: { items: RegWatchItem[] }) {
  const [openSource, setOpenSource] = useState<string | null>(null);

  const bySource = useMemo(() => {
    const map = new Map<string, RegWatchItem[]>();
    items.forEach((it) => {
      const key = it.source || "Unattributed";
      const bucket = map.get(key);
      if (bucket) bucket.push(it);
      else map.set(key, [it]);
    });
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [items]);

  /* Pre-filtered items never reached the model. Worth separating, because
   * they are the ones that cost nothing and the ones most likely to be
   * over-filtering if the gate is wrong. */
  const preFiltered = items.filter((i) =>
    (i.state_reason || "").includes("no financial-sector term"),
  );

  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing was rejected in this run.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="max-w-[85ch] text-[13px] text-muted-foreground">
        Publications the gate judged out of scope. They are kept so the decision
        is auditable and so an over-strict gate is visible — read a sample after
        each run. If something here should have been published, that is a gate
        problem, not a scraping one.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile label="Rejected" value={items.length} hint="in this run" />
        <StatTile
          label="Sources involved"
          value={bySource.length}
          hint="grouped below, noisiest first"
        />
        <StatTile
          label="Rejected before tagging"
          value={preFiltered.length}
          hint="Luxembourg official journal, no model call spent"
        />
      </div>

      {bySource.map(([source, bucket]) => {
        const open = openSource === source;
        const shown = open ? bucket : bucket.slice(0, 5);
        return (
          <Panel
            key={source}
            title={`${source} · ${bucket.length}`}
            note={bucket[0]?.source_category || undefined}
          >
            <ul className="space-y-2.5">
              {shown.map((item) => (
                <li key={item._ref ?? item.title} className="border-l-2 border-border pl-3">
                  {item.link ? (
                    <a
                      href={item.link}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-start gap-1 text-left text-[13.5px] font-medium leading-snug hover:underline"
                    >
                      {item.title}
                      <ExternalLink className="mt-[3px] h-3 w-3 shrink-0 text-muted-foreground" />
                    </a>
                  ) : (
                    <span className="text-[13.5px] font-medium leading-snug">{item.title}</span>
                  )}
                  <p className="mt-1 max-w-[85ch] text-[12.5px] leading-relaxed text-muted-foreground">
                    {item.state_reason || "No reason recorded."}
                  </p>
                  <p className="mt-1 text-[11.5px] tabular-nums text-muted-foreground">
                    {fmtDate(item.date)}
                  </p>
                </li>
              ))}
            </ul>
            {bucket.length > 5 ? (
              <button
                type="button"
                onClick={() => setOpenSource(open ? null : source)}
                className="mt-3 w-full rounded-md border border-border py-1.5 text-xs font-medium text-muted-foreground hover:border-primary hover:text-foreground"
              >
                {open
                  ? "Show the first 5"
                  : `Show all ${bucket.length} — ${bucket.length - 5} more`}
              </button>
            ) : null}
          </Panel>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------- *
 * Configuration — the rules in force, read-only
 * -------------------------------------------------------------------- */
function ConfigurationView({ meta }: { meta: RegWatchMeta | null }) {
  return (
    <div className="space-y-4">
      <p className="max-w-[80ch] text-[13px] text-muted-foreground">
        Read-only. The values that come from the run are read from{" "}
        <code>regwatch_meta.json</code>; the rules are described here but{" "}
        <strong>live in <code>regwatch_scraper.py</code></strong>, which is the only place they
        can be changed. If the two ever disagree, the scraper is right and this page is stale.
      </p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="From this run">
          <dl>
            <Field label="Window">
              {meta?.days_window ? `${meta.days_window} days` : null}
            </Field>
            <Field label="Last run">{fmtStamp(meta?.generated_at)}</Field>
          </dl>
        </Panel>

        <Panel title="Gate conditions" note="All must hold before an item publishes.">
          <ol className="ml-4 list-decimal space-y-1.5 text-[13px] text-secondary-foreground">
            <li>Judged relevant to the financial sector by triage.</li>
            <li>
              Has a regulation type — <code>REQUIRE_REGULATION_TYPE_TO_PUBLISH</code>.
            </li>
            <li>
              Has a framework or an in-scope sector —{" "}
              <code>REQUIRE_FRAMEWORK_OR_SECTOR_TO_PUBLISH</code>.
            </li>
            <li>
              If the type is the placeholder “Other”, also has a sector and a keyword —{" "}
              <code>REQUIRE_SECTOR_AND_KEYWORD_WHEN_TYPE_IS_OTHER</code>.
            </li>
            <li>
              A third-country or international publication states an EU, euro-area or
              Luxembourg nexus.
            </li>
          </ol>
        </Panel>

        <Panel
          title="Jurisdiction"
          note="Decided from the source code, because geo is empty on most items."
        >
          <dl>
            <Field label="Luxembourg">{`${LU_SOURCE_CODES.size} source codes`}</Field>
            <Field label="Third country">{`${NON_EU_SOURCE_CODES.size} source codes`}</Field>
            <Field
              label="Everything else"
              help="An unrecognised code defaults to EU and is never capped, so a new source is never silently suppressed"
            >
              treated as European Union
            </Field>
            <Field
              label="Nexus judged from"
              help="why_kept and actions are excluded: the prompt asks for them from a Luxembourg standpoint, so they always mention Luxembourg"
            >
              title, original title, summary
            </Field>
          </dl>
        </Panel>

        <Panel title="Caps applied to a capped item">
          <dl>
            <Field label="Importance tier">floored at 3</Field>
            <Field label="Urgency">capped at Medium</Field>
            <Field label="State">held in pending review</Field>
            <Field label="Alert flag">never set</Field>
          </dl>
        </Panel>
      </div>
    </div>
  );
}
