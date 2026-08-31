import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Download, Loader2, AlertTriangle } from "lucide-react";
import { TopBar } from "@/components/haca/top-bar";
import {
  CATALOGUE_REPLI,
  genererLettre,
  genererOffre,
  getCatalogue,
  urlTelechargement,
  type Catalogue,
  type ContexteLettre,
  type ContexteOffre,
  type Personne,
  type Rapport,
} from "@/lib/generation-api";
import {
  classerRapport,
  contientBloquant,
  cvDistincts,
  heuresAffichees,
  heuresServeur,
  lignesMetier,
  pagesLettre,
  slidesEstimes,
  tableauScinde,
  type Message,
} from "@/lib/generation-logic";

export const Route = createFileRoute("/generation")({
  head: () => ({
    meta: [
      { title: "Génération de documents — Projet 45 | HACA Partners" },
      {
        name: "description",
        content:
          "Générez une offre commerciale .pptx ou une lettre d'engagement .docx à partir des bibliothèques de contenu validées du cabinet.",
      },
      { property: "og:title", content: "Génération de documents — Projet 45" },
      {
        property: "og:description",
        content:
          "Offre commerciale .pptx et lettre d'engagement .docx assemblées depuis les bibliothèques validées du cabinet.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PageGeneration,
});

/* ------------------------------ primitives ------------------------------ */

function Bloc({
  titre,
  compteur,
  children,
  premier,
}: {
  titre: string;
  compteur?: string;
  children: React.ReactNode;
  premier?: boolean;
}) {
  return (
    <section
      className="px-[18px] py-[18px]"
      style={{ borderTop: premier ? "none" : "1px solid var(--p45-filet)" }}
    >
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="p45-label">{titre}</h2>
        {compteur ? (
          <span className="num text-[11.5px]" style={{ color: "var(--p45-texte-2)" }}>
            {compteur}
          </span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Grille({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="grid gap-y-[15px] gap-x-4"
      style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}
    >
      {children}
    </div>
  );
}

function Champ({
  id,
  label,
  obligatoire,
  aide,
  erreur,
  children,
}: {
  id: string;
  label: string;
  obligatoire?: boolean | undefined;
  aide?: string | undefined;
  erreur?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-[5px]">
      <label htmlFor={id} className="text-[12.5px]" style={{ color: "var(--p45-texte-2)" }}>
        {label}
        {obligatoire ? <span style={{ color: "var(--p45-accent)" }}> *</span> : null}
      </label>
      {children}
      {erreur ? (
        <p className="text-[11.5px]" style={{ color: "var(--p45-accent)" }}>
          {erreur}
        </p>
      ) : aide ? (
        <p className="text-[11.5px]" style={{ color: "var(--p45-texte-3)" }}>
          {aide}
        </p>
      ) : null}
    </div>
  );
}

function Bandeau({
  ton,
  children,
}: {
  ton: "ok" | "attention";
  children: React.ReactNode;
}) {
  const couleurs =
    ton === "ok"
      ? {
          color: "var(--p45-ok-texte)",
          background: "var(--p45-ok-fond)",
          border: "1px solid var(--p45-ok-filet)",
        }
      : {
          color: "var(--p45-attention-texte)",
          background: "var(--p45-attention-fond)",
          border: "1px solid var(--p45-attention-filet)",
        };
  return (
    <div
      className="mb-4 flex items-start gap-2 rounded-sm px-3 py-2 text-[12.5px]"
      style={couleurs}
    >
      {ton === "ok" ? (
        <Check size={14} className="mt-[2px] shrink-0" aria-hidden />
      ) : (
        <AlertTriangle size={14} className="mt-[2px] shrink-0" aria-hidden />
      )}
      <span>{children}</span>
    </div>
  );
}

function Badge({ ton, children }: { ton: "ok" | "attention" | "accent"; children: React.ReactNode }) {
  const couleurs =
    ton === "ok"
      ? { color: "var(--p45-ok-texte)", background: "var(--p45-ok-fond)", border: "1px solid var(--p45-ok-filet)" }
      : ton === "attention"
        ? {
            color: "var(--p45-attention-texte)",
            background: "var(--p45-attention-fond)",
            border: "1px solid var(--p45-attention-filet)",
          }
        : {
            color: "var(--p45-accent)",
            background: "var(--p45-accent-doux)",
            border: "1px solid var(--p45-accent)",
          };
  return (
    <span
      className="rounded-sm px-[5px] py-[1px] text-[10px] font-semibold uppercase tracking-[.08em]"
      style={couleurs}
    >
      {children}
    </span>
  );
}

/* ------------------------------ état du formulaire ------------------------------ */

type EtatOffre = {
  client: string;
  sujet: string;
  personne: string;
  logo: string;
  prestations: string[];
  intervenants: string[];
  signataire1: string;
  signataire2: string;
  honoraires: string;
  periode: string;
  langue: string;
  lieu: string;
  annexeComplete: boolean;
};

type EtatLettre = {
  forme: "sicar" | "sif" | "raif";
  fonds: string;
  adresse: string;
  ville: string;
  date: string;
  debut: string;
  fin: string;
  honoraires: string;
  indice: string;
  signataire: string;
  clauses: string[];
};

const OFFRE_INITIALE: Omit<EtatOffre, "prestations"> = {
  client: "Groupe Ardenn",
  sujet: "Service proposal — trainings:",
  personne: "Mme Bertaud",
  logo: "",
  intervenants: [],
  signataire1: "",
  signataire2: "",
  honoraires: "24.000 EUR",
  periode: "second half of 2027",
  langue: "English",
  lieu: "",
  annexeComplete: false,
};

const LETTRE_INITIALE: Omit<EtatLettre, "clauses"> = {
  forme: "sif",
  fonds: "Northgate Capital S.A. SICAR",
  adresse: "12, boulevard Royal",
  ville: "L-2449 Luxembourg",
  date: "24 August 2026",
  debut: "1 January 2026",
  fin: "31 December 2026",
  honoraires: "18,400.00",
  indice: "1.007,14",
  signataire: "",
};

const FORMES: { valeur: EtatLettre["forme"]; libelle: string }[] = [
  { valeur: "sicar", libelle: "SA SICAR" },
  { valeur: "sif", libelle: "SA SICAV SIF" },
  { valeur: "raif", libelle: "SCSp SICAV-RAIF" },
];

function memeEnsemble(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

/* ------------------------------ page ------------------------------ */

function PageGeneration() {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [horsLigne, setHorsLigne] = useState(false);
  const [onglet, setOnglet] = useState<"offre" | "lettre">("offre");

  const [offre, setOffre] = useState<EtatOffre>({ ...OFFRE_INITIALE, prestations: [] });
  const [lettre, setLettre] = useState<EtatLettre>({ ...LETTRE_INITIALE, clauses: [] });
  const [touches, setTouches] = useState<Record<string, boolean>>({});
  const [tenteOffre, setTenteOffre] = useState(false);
  const [tenteLettre, setTenteLettre] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [rapports, setRapports] = useState<{ offre?: Rapport; lettre?: Rapport }>({});

  useEffect(() => {
    let annule = false;
    getCatalogue()
      .then((c) => {
        if (!annule) initialiser(c, false);
      })
      .catch(() => {
        if (!annule) initialiser(CATALOGUE_REPLI, true);
      });

    function initialiser(c: Catalogue, replis: boolean) {
      setCatalogue(c);
      setHorsLigne(replis);
      setOffre((prec) => ({
        ...prec,
        prestations: c.prestations.slice(0, 8).map((p) => p.code),
        signataire1: prec.signataire1 || (c.signataires[0]?.code ?? ""),
      }));
      setLettre((prec) => ({
        ...prec,
        signataire: prec.signataire || (c.signataires[0]?.code ?? ""),
        clauses: c.clauses.filter((cl) => cl.formes.includes(prec.forme)).map((cl) => cl.cle),
      }));
    }

    return () => {
      annule = true;
    };
  }, []);

  const prestationsChoisies = useMemo(
    () => (catalogue?.prestations ?? []).filter((p) => offre.prestations.includes(p.code)),
    [catalogue, offre.prestations],
  );

  const intervenantsParPrestation = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const p of prestationsChoisies) map[p.code] = offre.intervenants;
    return map;
  }, [prestationsChoisies, offre.intervenants]);

  const cv = cvDistincts(prestationsChoisies, intervenantsParPrestation);
  const scinde = tableauScinde(prestationsChoisies.length);
  const metiers = lignesMetier(prestationsChoisies);
  const slides = slidesEstimes({
    prestations: prestationsChoisies,
    nbCv: cv.length,
    annexeComplete: offre.annexeComplete,
  });

  const clausesProposees = useMemo(
    () => (catalogue?.clauses ?? []).filter((c) => c.formes.includes(lettre.forme)).map((c) => c.cle),
    [catalogue, lettre.forme],
  );
  const devie = !memeEnsemble(lettre.clauses, clausesProposees);

  /* champs obligatoires manquants */
  const manquantsOffre = useMemo(() => {
    const m: { cle: string; nom: string; message: string }[] = [];
    if (!offre.client.trim()) m.push({ cle: "client", nom: "Client", message: "Indiquez le nom du client" });
    if (!offre.sujet.trim()) m.push({ cle: "sujet", nom: "Objet de l'offre", message: "Indiquez l'objet de l'offre" });
    if (!offre.honoraires.trim())
      m.push({ cle: "honoraires", nom: "Honoraires", message: "Indiquez le montant des honoraires" });
    if (!offre.signataire1)
      m.push({ cle: "signataire1", nom: "Premier signataire", message: "Choisissez le premier signataire" });
    if (offre.prestations.length === 0)
      m.push({ cle: "prestations", nom: "Formations", message: "Retenez au moins une formation" });
    return m;
  }, [offre]);

  const manquantsLettre = useMemo(() => {
    const m: { cle: string; nom: string; message: string }[] = [];
    if (!lettre.fonds.trim()) m.push({ cle: "fonds", nom: "Nom du fonds", message: "Indiquez le nom du fonds" });
    if (!lettre.date.trim()) m.push({ cle: "date", nom: "Date de la lettre", message: "Indiquez la date de la lettre" });
    if (!lettre.debut.trim())
      m.push({ cle: "debut", nom: "Début d'exercice", message: "Indiquez le début de l'exercice" });
    if (!lettre.fin.trim()) m.push({ cle: "fin", nom: "Fin d'exercice", message: "Indiquez la fin de l'exercice" });
    if (!lettre.honoraires.trim())
      m.push({ cle: "honoraires_l", nom: "Honoraires", message: "Indiquez le montant des honoraires" });
    if (!lettre.signataire)
      m.push({ cle: "signataire_l", nom: "Signataire", message: "Choisissez le signataire de la lettre" });
    return m;
  }, [lettre]);

  const manquants = onglet === "offre" ? manquantsOffre : manquantsLettre;
  const tente = onglet === "offre" ? tenteOffre : tenteLettre;

  function erreurDe(cle: string): string | undefined {
    if (!touches[cle] && !tente) return undefined;
    return manquants.find((m) => m.cle === cle)?.message;
  }

  const champsRenseignes = useMemo(() => {
    const valeurs = [
      lettre.fonds,
      lettre.adresse,
      lettre.ville,
      lettre.date,
      lettre.debut,
      lettre.fin,
      lettre.honoraires,
      lettre.indice,
      lettre.signataire,
      lettre.forme,
    ];
    return valeurs.filter((v) => v.trim() !== "").length;
  }, [lettre]);

  /* génération */
  async function generer() {
    if (onglet === "offre") setTenteOffre(true);
    else setTenteLettre(true);
    if (manquants.length > 0) return;
    setEnCours(true);
    try {
      const trouver = (code: string): Personne | undefined =>
        catalogue?.signataires.find((s) => s.code === code);
      if (onglet === "offre") {
        const contexte: ContexteOffre = {
          CLIENT: offre.client,
          SUJET: offre.sujet,
          ...(offre.personne ? { PERSONNE: offre.personne } : {}),
          ...(offre.honoraires ? { BUDGET: offre.honoraires } : {}),
          ...(offre.logo ? { LOGO: offre.logo } : {}),
          prestations: prestationsChoisies.map((p) => ({ ...p, intervenants: offre.intervenants })),
          budget: { heures: heuresServeur(prestationsChoisies) },
          mission: {
            ...(offre.langue ? { langue: offre.langue } : {}),
            ...(offre.periode ? { date: offre.periode } : {}),
            ...(offre.lieu ? { lieu: offre.lieu } : {}),
          },
          ...(trouver(offre.signataire1)
            ? {
                signataire1: {
                  nom: trouver(offre.signataire1)!.nom,
                  fonction: trouver(offre.signataire1)!.fonction,
                },
              }
            : {}),
          ...(trouver(offre.signataire2)
            ? {
                signataire2: {
                  nom: trouver(offre.signataire2)!.nom,
                  fonction: trouver(offre.signataire2)!.fonction,
                },
              }
            : {}),
          options: { annexe_complete: offre.annexeComplete },
        };
        const rapport = await genererOffre(contexte);
        setRapports((r) => ({ ...r, offre: rapport }));
      } else {
        const s = trouver(lettre.signataire)!;
        const contexte: ContexteLettre = {
          forme: lettre.forme,
          FONDS: lettre.fonds,
          fonds: { adresse: lettre.adresse, ville: lettre.ville },
          DATE: lettre.date,
          exercice: { debut: lettre.debut, fin: lettre.fin },
          HONORAIRES: lettre.honoraires,
          ...(lettre.indice ? { indice: lettre.indice } : {}),
          signataire: { nom: s.nom, fonction: s.fonction },
          ...(devie ? { clauses: lettre.clauses } : {}),
        };
        const rapport = await genererLettre(contexte);
        setRapports((r) => ({ ...r, lettre: rapport }));
      }
    } catch {
      setRapports((r) => ({
        ...r,
        [onglet]: {
          ok: false,
          code: "ERREUR_INTERNE",
          message: "Service de génération injoignable — le document n'a pas été produit.",
          imputable_saisie: false,
          avertissements: [],
        } as Rapport,
      }));
    } finally {
      setEnCours(false);
    }
  }

  const rapport = rapports[onglet];
  const messages: Message[] = rapport ? classerRapport(rapport) : [];
  const bloquant = contientBloquant(messages);

  const slidesReels = rapport && rapport.ok ? rapport.slides : undefined;
  const clausesReelles = rapport && rapport.ok ? rapport.clauses : undefined;
  const cvReels = rapport && rapport.ok ? rapport.cv : undefined;
  const prestationsReelles = rapport && rapport.ok ? rapport.prestations : undefined;

  return (
    <div className="p45 min-h-screen">
      <TopBar />

      <main className="mx-auto" style={{ maxWidth: 1180, padding: "34px 26px 90px" }}>
        {horsLigne ? (
          <Bandeau ton="attention">
            Service de génération injoignable — vérifiez qu'il est démarré
          </Bandeau>
        ) : null}

        <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div style={{ maxWidth: 660 }}>
            <h1 className="text-[27px] font-bold leading-tight">Génération de documents</h1>
            <p className="mt-2 text-[13.5px]" style={{ color: "var(--p45-texte-2)" }}>
              Le texte vient des bibliothèques validées du cabinet. Rien n'est rédigé par l'IA :
              seules les données saisies ici changent d'un document à l'autre.
            </p>
          </div>
          <Onglets onglet={onglet} setOnglet={setOnglet} />
        </header>

        <div className="p45-corps">
          <div
            id={onglet === "offre" ? "panneau-offre" : "panneau-lettre"}
            role="tabpanel"
            aria-labelledby={onglet === "offre" ? "onglet-offre" : "onglet-lettre"}
            tabIndex={0}
            className="rounded-sm"
            style={{ background: "var(--p45-surface)", border: "1px solid var(--p45-filet)" }}
          >
            {onglet === "offre" ? (
              <FormulaireOffre
                catalogue={catalogue}
                etat={offre}
                setEtat={setOffre}
                erreurDe={erreurDe}
                marquer={(cle) => setTouches((t) => ({ ...t, [cle]: true }))}
                heures={heuresAffichees(prestationsChoisies)}
              />
            ) : (
              <FormulaireLettre
                catalogue={catalogue}
                etat={lettre}
                setEtat={setLettre}
                erreurDe={erreurDe}
                marquer={(cle) => setTouches((t) => ({ ...t, [cle]: true }))}
                clausesProposees={clausesProposees}
                devie={devie}
              />
            )}
          </div>

          <aside className="p45-aside flex flex-col gap-[22px]">
            <div
              className="rounded-sm"
              style={{ background: "var(--p45-surface)", border: "1px solid var(--p45-filet)" }}
            >
              <div className="px-[16px] pb-3 pt-[14px]">
                <h2 className="text-[14.5px]" style={{ fontWeight: 650 }}>
                  Ce qui sera produit
                </h2>
                <p className="mt-[2px] text-[11.5px]" style={{ color: "var(--p45-texte-3)" }}>
                  {onglet === "offre"
                    ? "Recalculé à chaque changement"
                    : "Numérotation calculée à l'assemblage"}
                </p>
              </div>
              <Compteurs
                items={
                  onglet === "offre"
                    ? [
                        { valeur: slidesReels ?? slides, label: "slides" },
                        {
                          valeur: prestationsReelles?.length ?? prestationsChoisies.length,
                          label: "prestations",
                        },
                        { valeur: cvReels?.length ?? cv.length, label: "CV" },
                      ]
                    : [
                        { valeur: clausesReelles?.length ?? lettre.clauses.length, label: "clauses" },
                        {
                          valeur: pagesLettre(clausesReelles?.length ?? lettre.clauses.length),
                          label: "pages",
                        },
                        { valeur: champsRenseignes, label: "champs" },
                      ]
                }
              />
              <Plan
                onglet={onglet}
                scinde={scinde}
                metiers={metiers}
                annexeComplete={offre.annexeComplete}
                nbPrestations={prestationsChoisies.length}
                nbCv={cv.length}
                nbClauses={clausesReelles?.length ?? lettre.clauses.length}
              />
              <div style={{ borderTop: "1px solid var(--p45-filet)" }} className="p-[16px]">
                <button
                  type="button"
                  onClick={generer}
                  disabled={manquants.length > 0 || enCours}
                  title={
                    manquants.length > 0
                      ? `Champ à renseigner : ${manquants[0]!.nom}`
                      : undefined
                  }
                  className="flex w-full items-center justify-center gap-2 rounded-sm px-3 py-[9px] text-[14px] font-semibold disabled:opacity-45"
                  style={{ background: "var(--p45-accent)", color: "var(--p45-sur-accent)" }}
                >
                  {enCours ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null}
                  {onglet === "offre" ? "Générer l'offre" : "Générer la lettre"}
                </button>
                <button
                  type="button"
                  className="mt-2 w-full rounded-sm px-3 py-[8px] text-[13.5px]"
                  style={{
                    border: "1px solid var(--p45-filet-fort)",
                    color: "var(--p45-texte)",
                    background: "var(--p45-surface-2)",
                  }}
                >
                  Aperçu
                </button>
                <p className="mt-2 text-center text-[11.5px]" style={{ color: "var(--p45-texte-3)" }}>
                  {onglet === "offre"
                    ? "Une offre part en .pptx — pas de format à choisir"
                    : "Une lettre part en .docx"}
                </p>
              </div>
            </div>

            <div aria-live="polite">
              {rapport ? (
                <CompteRendu rapport={rapport} messages={messages} bloquant={bloquant} />
              ) : null}
            </div>
          </aside>
        </div>
      </main>

      <style>{`
        .p45 {
          --p45-fond: #f4f5f7;
          --p45-surface: #ffffff;
          --p45-surface-2: #fafbfc;
          --p45-texte: #16232e;
          --p45-texte-2: #4a5a68;
          --p45-texte-3: #7c8b98;
          --p45-filet: #dfe3e8;
          --p45-filet-fort: #c6ced6;
          --p45-barre: #12293d;
          --p45-accent: #e2003a;
          --p45-accent-doux: #fdecf0;
          --p45-attention-texte: #8e5606;
          --p45-attention-fond: #fcf4e6;
          --p45-attention-filet: #ead5ac;
          --p45-ok-texte: #12613f;
          --p45-ok-fond: #ebf6f0;
          --p45-ok-filet: #bedfcd;
          --p45-sur-barre: #ffffff;
          --p45-sur-accent: #ffffff;
          --p45-police: "Inter", ui-sans-serif, system-ui, sans-serif;
          --p45-mono: "JetBrains Mono", ui-monospace, monospace;
          font-family: var(--p45-police);
          background: var(--p45-fond);
          color: var(--p45-texte);
        }
        .p45-corps { display: grid; grid-template-columns: 1fr 350px; gap: 22px; align-items: start; }
        .p45-aside { position: sticky; top: 22px; }
        .p45 .num { font-family: var(--p45-mono); }
        .p45 .p45-label { font-size: 14px; font-weight: 650; color: var(--p45-texte); }
        @media (max-width: 900px) {
          .p45-corps { grid-template-columns: 1fr; }
          .p45-aside { position: static; }
        }
      `}</style>
    </div>
  );
}

/* ------------------------------ barre + onglets ------------------------------ */

function Onglets({
  onglet,
  setOnglet,
}: {
  onglet: "offre" | "lettre";
  setOnglet: (o: "offre" | "lettre") => void;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const items = [
    { cle: "offre" as const, libelle: "Offre commerciale", ext: ".pptx" },
    { cle: "lettre" as const, libelle: "Lettre d'engagement", ext: ".docx" },
  ];
  return (
    <div role="tablist" aria-label="Type de document" className="flex items-end gap-5">
      {items.map(({ cle, libelle, ext }) => {
        const actif = onglet === cle;
        return (
          <button
            key={cle}
            ref={(el) => {
              refs.current[cle] = el;
            }}
            id={`onglet-${cle}`}
            role="tab"
            type="button"
            aria-selected={actif}
            aria-controls={`panneau-${cle}`}
            tabIndex={actif ? 0 : -1}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                e.preventDefault();
                const suivant = cle === "offre" ? "lettre" : "offre";
                setOnglet(suivant);
                refs.current[suivant]?.focus();
              }
            }}
            onClick={() => setOnglet(cle)}
            className="flex items-center gap-2 pb-[7px] text-[14px]"
            style={{
              borderBottom: `2px solid ${actif ? "var(--p45-texte)" : "transparent"}`,
              fontWeight: actif ? 600 : 400,
              color: actif ? "var(--p45-texte)" : "var(--p45-texte-2)",
            }}
          >
            {libelle}
            <span
              className="mono rounded-sm px-[5px] py-[1px] text-[11px]"
              style={{
                background: "var(--p45-surface-2)",
                border: "1px solid var(--p45-filet)",
                color: "var(--p45-texte-3)",
              }}
            >
              {ext}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------ formulaire offre ------------------------------ */

function FormulaireOffre({
  catalogue,
  etat,
  setEtat,
  erreurDe,
  marquer,
  heures,
}: {
  catalogue: Catalogue | null;
  etat: EtatOffre;
  setEtat: React.Dispatch<React.SetStateAction<EtatOffre>>;
  erreurDe: (cle: string) => string | undefined;
  marquer: (cle: string) => void;
  heures: string;
}) {
  const prestations = catalogue?.prestations ?? [];
  const personnes = catalogue?.intervenants ?? [];
  const signataires = catalogue?.signataires ?? [];
  const [recherche, setRecherche] = useState("");

  function basculer(code: string) {
    setEtat((e) => ({
      ...e,
      prestations: e.prestations.includes(code)
        ? e.prestations.filter((c) => c !== code)
        : [...e.prestations, code],
    }));
  }

  const filtrees = personnes.filter((p) =>
    `${p.nom} ${p.fonction}`.toLowerCase().includes(recherche.toLowerCase()),
  );

  return (
    <>
      <Bloc titre="Le client" premier>
        <Grille>
          <Champ id="o-client" label="Client" obligatoire erreur={erreurDe("client")}>
            <input
              id="o-client"
              value={etat.client}
              data-invalide={Boolean(erreurDe("client"))}
              onChange={(e) => setEtat((s) => ({ ...s, client: e.target.value }))}
              onBlur={() => marquer("client")}
            />
          </Champ>
          <Champ id="o-sujet" label="Objet de l'offre" obligatoire erreur={erreurDe("sujet")}>
            <input
              id="o-sujet"
              value={etat.sujet}
              data-invalide={Boolean(erreurDe("sujet"))}
              onChange={(e) => setEtat((s) => ({ ...s, sujet: e.target.value }))}
              onBlur={() => marquer("sujet")}
            />
          </Champ>
          <Champ id="o-personne" label="Interlocuteur">
            <input
              id="o-personne"
              value={etat.personne}
              onChange={(e) => setEtat((s) => ({ ...s, personne: e.target.value }))}
            />
          </Champ>
          <Champ
            id="o-logo"
            label="Logo du client"
            aide="Absent, la zone reste vide sur la couverture"
          >
            <input
              id="o-logo"
              type="file"
              accept="image/*"
              onChange={(e) => setEtat((s) => ({ ...s, logo: e.target.files?.[0]?.name ?? "" }))}
            />
          </Champ>
        </Grille>
      </Bloc>

      <Bloc
        titre="Formations"
        compteur={`${etat.prestations.length} retenues sur ${prestations.length}`}
      >
        <div
          className="grid gap-x-6"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))" }}
        >
          {prestations.map((p) => (
            <label
              key={p.code}
              className="flex items-center gap-2 py-[7px] text-[13.5px]"
              style={{ borderBottom: "1px solid var(--p45-filet)" }}
            >
              <input
                type="checkbox"
                checked={etat.prestations.includes(p.code)}
                onChange={() => basculer(p.code)}
              />
              <span className="flex-1">{p.libelle}</span>
              <span className="num text-[11.5px]" style={{ color: "var(--p45-texte-3)" }}>
                {p.heures.includes("to") ? p.heures.replace(" to ", "–") : p.heures} h
              </span>
            </label>
          ))}
        </div>
        {etat.prestations.length === 0 ? (
          <p className="mt-2 text-[11.5px]" style={{ color: "var(--p45-accent)" }}>
            Retenez au moins une formation : une offre sans formation serait vide.
          </p>
        ) : null}
      </Bloc>

      <Bloc titre="L'équipe" compteur={`${personnes.length} personnes au répertoire`}>
        <Grille>
          <Champ
            id="o-intervenants"
            label="Intervenants"
            aide="Leur CV est inséré dans l'ordre des formations, sans doublon"
          >
            <div className="flex flex-col gap-2">
              <input
                id="o-intervenants"
                value={recherche}
                placeholder="Rechercher une personne"
                onChange={(e) => setRecherche(e.target.value)}
              />
              <div
                className="max-h-[132px] overflow-auto rounded-sm px-2 py-1"
                style={{ border: "1px solid var(--p45-filet)", background: "var(--p45-surface-2)" }}
              >
                {filtrees.map((p) => (
                  <label key={p.code} className="flex items-center gap-2 py-[5px] text-[13px]">
                    <input
                      type="checkbox"
                      checked={etat.intervenants.includes(p.code)}
                      onChange={() =>
                        setEtat((s) => ({
                          ...s,
                          intervenants: s.intervenants.includes(p.code)
                            ? s.intervenants.filter((c) => c !== p.code)
                            : [...s.intervenants, p.code],
                        }))
                      }
                    />
                    <span>
                      {p.nom} — {p.fonction}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </Champ>
          <Champ
            id="o-sig1"
            label="Premier signataire"
            obligatoire
            aide={`${signataires.length} associés et directeurs proposés`}
            erreur={erreurDe("signataire1")}
          >
            <select
              id="o-sig1"
              value={etat.signataire1}
              data-invalide={Boolean(erreurDe("signataire1"))}
              onBlur={() => marquer("signataire1")}
              onChange={(e) => setEtat((s) => ({ ...s, signataire1: e.target.value }))}
            >
              <option value="">—</option>
              {signataires.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.nom} — {s.fonction}
                </option>
              ))}
            </select>
          </Champ>
          <Champ id="o-sig2" label="Second signataire">
            <select
              id="o-sig2"
              value={etat.signataire2}
              onChange={(e) => setEtat((s) => ({ ...s, signataire2: e.target.value }))}
            >
              <option value="">—</option>
              {signataires.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.nom} — {s.fonction}
                </option>
              ))}
            </select>
          </Champ>
        </Grille>
      </Bloc>

      <Bloc titre="Conditions">
        <Grille>
          <Champ id="o-honoraires" label="Honoraires" obligatoire erreur={erreurDe("honoraires")}>
            <input
              id="o-honoraires"
              value={etat.honoraires}
              data-invalide={Boolean(erreurDe("honoraires"))}
              onBlur={() => marquer("honoraires")}
              onChange={(e) => setEtat((s) => ({ ...s, honoraires: e.target.value }))}
            />
          </Champ>
          <Champ id="o-heures" label="Volume d'heures" aide="Calculé depuis les formations retenues">
            <input id="o-heures" className="num" readOnly value={heures} />
          </Champ>
          <Champ id="o-periode" label="Période">
            <input
              id="o-periode"
              value={etat.periode}
              onChange={(e) => setEtat((s) => ({ ...s, periode: e.target.value }))}
            />
          </Champ>
          <Champ id="o-langue" label="Langue">
            <select
              id="o-langue"
              value={etat.langue}
              onChange={(e) => setEtat((s) => ({ ...s, langue: e.target.value }))}
            >
              <option value="English">English</option>
              <option value="Français">Français</option>
            </select>
          </Champ>
          <Champ id="o-lieu" label="Lieu">
            <input
              id="o-lieu"
              value={etat.lieu}
              onChange={(e) => setEtat((s) => ({ ...s, lieu: e.target.value }))}
            />
          </Champ>
          <Champ id="o-annexe" label="Annexe" aide={'"Complète" conserve les 12 pages'}>
            <select
              id="o-annexe"
              value={etat.annexeComplete ? "complete" : "lignes"}
              onChange={(e) =>
                setEtat((s) => ({ ...s, annexeComplete: e.target.value === "complete" }))
              }
            >
              <option value="lignes">Lignes de métier concernées</option>
              <option value="complete">Complète</option>
            </select>
          </Champ>
        </Grille>
      </Bloc>
    </>
  );
}

/* ------------------------------ formulaire lettre ------------------------------ */

function FormulaireLettre({
  catalogue,
  etat,
  setEtat,
  erreurDe,
  marquer,
  clausesProposees,
  devie,
}: {
  catalogue: Catalogue | null;
  etat: EtatLettre;
  setEtat: React.Dispatch<React.SetStateAction<EtatLettre>>;
  erreurDe: (cle: string) => string | undefined;
  marquer: (cle: string) => void;
  clausesProposees: string[];
  devie: boolean;
}) {
  const clauses = catalogue?.clauses ?? [];
  const signataires = catalogue?.signataires ?? [];

  function changerForme(forme: EtatLettre["forme"]) {
    const proposition = clauses.filter((c) => c.formes.includes(forme)).map((c) => c.cle);
    if (devie) {
      if (typeof window !== "undefined") {
        const ok = window.confirm(
          "Vos choix de clauses seront remplacés par la proposition de cette forme juridique. Continuer ?",
        );
        if (!ok) return;
      }
    }
    setEtat((s) => ({ ...s, forme, clauses: proposition }));
  }

  return (
    <>
      <Bloc titre="Le fonds" premier>
        <Bandeau ton="ok">
          Les clauses sont celles validées par le cabinet et ne sont pas modifiables ici. En retirer
          ou en ajouter reste possible, et laisse une trace dans le compte rendu.
        </Bandeau>
        <Grille>
          <Champ id="l-forme" label="Forme juridique" obligatoire aide="Détermine les clauses pré-cochées">
            <select
              id="l-forme"
              value={etat.forme}
              onChange={(e) => changerForme(e.target.value as EtatLettre["forme"])}
            >
              {FORMES.map((f) => (
                <option key={f.valeur} value={f.valeur}>
                  {f.libelle}
                </option>
              ))}
            </select>
          </Champ>
          <Champ id="l-fonds" label="Nom du fonds" obligatoire erreur={erreurDe("fonds")}>
            <input
              id="l-fonds"
              value={etat.fonds}
              data-invalide={Boolean(erreurDe("fonds"))}
              onBlur={() => marquer("fonds")}
              onChange={(e) => setEtat((s) => ({ ...s, fonds: e.target.value }))}
            />
          </Champ>
          <Champ id="l-adresse" label="Adresse">
            <input
              id="l-adresse"
              value={etat.adresse}
              onChange={(e) => setEtat((s) => ({ ...s, adresse: e.target.value }))}
            />
          </Champ>
          <Champ id="l-ville" label="Code postal et ville">
            <input
              id="l-ville"
              value={etat.ville}
              onChange={(e) => setEtat((s) => ({ ...s, ville: e.target.value }))}
            />
          </Champ>
        </Grille>
      </Bloc>

      <Bloc titre="La mission">
        <Grille>
          <Champ id="l-date" label="Date de la lettre" obligatoire erreur={erreurDe("date")}>
            <input
              id="l-date"
              value={etat.date}
              data-invalide={Boolean(erreurDe("date"))}
              onBlur={() => marquer("date")}
              onChange={(e) => setEtat((s) => ({ ...s, date: e.target.value }))}
            />
          </Champ>
          <Champ id="l-debut" label="Début d'exercice" obligatoire erreur={erreurDe("debut")}>
            <input
              id="l-debut"
              value={etat.debut}
              data-invalide={Boolean(erreurDe("debut"))}
              onBlur={() => marquer("debut")}
              onChange={(e) => setEtat((s) => ({ ...s, debut: e.target.value }))}
            />
          </Champ>
          <Champ id="l-fin" label="Fin d'exercice" obligatoire erreur={erreurDe("fin")}>
            <input
              id="l-fin"
              value={etat.fin}
              data-invalide={Boolean(erreurDe("fin"))}
              onBlur={() => marquer("fin")}
              onChange={(e) => setEtat((s) => ({ ...s, fin: e.target.value }))}
            />
          </Champ>
          <Champ id="l-honoraires" label="Honoraires" obligatoire erreur={erreurDe("honoraires_l")}>
            <input
              id="l-honoraires"
              className="num"
              value={etat.honoraires}
              data-invalide={Boolean(erreurDe("honoraires_l"))}
              onBlur={() => marquer("honoraires_l")}
              onChange={(e) => setEtat((s) => ({ ...s, honoraires: e.target.value }))}
            />
          </Champ>
          <Champ id="l-indice" label="Indice d'échelle mobile">
            <input
              id="l-indice"
              className="num"
              value={etat.indice}
              onChange={(e) => setEtat((s) => ({ ...s, indice: e.target.value }))}
            />
          </Champ>
          <Champ id="l-sig" label="Signataire" obligatoire erreur={erreurDe("signataire_l")}>
            <select
              id="l-sig"
              value={etat.signataire}
              data-invalide={Boolean(erreurDe("signataire_l"))}
              onBlur={() => marquer("signataire_l")}
              onChange={(e) => setEtat((s) => ({ ...s, signataire: e.target.value }))}
            >
              <option value="">—</option>
              {signataires.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.nom} — {s.fonction}
                </option>
              ))}
            </select>
          </Champ>
        </Grille>
      </Bloc>

      <Bloc
        titre="Clauses"
        compteur={`${etat.clauses.length} retenues${devie ? " · proposition modifiée" : ""}`}
      >
        <div
          className="grid gap-x-6"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))" }}
        >
          {clauses.map((c) => {
            const cochee = etat.clauses.includes(c.cle);
            const proposee = clausesProposees.includes(c.cle);
            const ajoutee = cochee && !proposee;
            const retiree = !cochee && proposee;
            return (
              <label
                key={c.cle}
                className="flex items-center gap-2 py-[7px] text-[13.5px]"
                style={{ borderBottom: "1px solid var(--p45-filet)" }}
              >
                <input
                  type="checkbox"
                  checked={cochee}
                  onChange={() =>
                    setEtat((s) => ({
                      ...s,
                      clauses: cochee
                        ? s.clauses.filter((k) => k !== c.cle)
                        : clauses.filter((x) => x.cle === c.cle || s.clauses.includes(x.cle)).map((x) => x.cle),
                    }))
                  }
                />
                <span
                  className="flex-1"
                  style={
                    retiree
                      ? { color: "var(--p45-texte-3)", textDecoration: "line-through" }
                      : undefined
                  }
                >
                  {c.titre}
                </span>
                {ajoutee ? <Badge ton="ok">Ajoutée</Badge> : null}
                {retiree ? <Badge ton="attention">Retirée</Badge> : null}
              </label>
            );
          })}
        </div>
      </Bloc>
    </>
  );
}

/* ------------------------------ colonne droite ------------------------------ */

function Compteurs({ items }: { items: { valeur: number; label: string }[] }) {
  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: "repeat(3, 1fr)",
        borderTop: "1px solid var(--p45-filet)",
        borderBottom: "1px solid var(--p45-filet)",
      }}
    >
      {items.map((item, i) => (
        <div
          key={item.label}
          className="px-2 py-[12px] text-center"
          style={{ borderLeft: i === 0 ? "none" : "1px solid var(--p45-filet)" }}
        >
          <div className="num text-[22px] font-bold leading-none">{item.valeur}</div>
          <div
            className="mt-[5px] text-[10.5px] uppercase tracking-[.08em]"
            style={{ color: "var(--p45-texte-3)" }}
          >
            {item.label}
          </div>
        </div>
      ))}
    </div>
  );
}

function Plan({
  onglet,
  scinde,
  metiers,
  annexeComplete,
  nbPrestations,
  nbCv,
  nbClauses,
}: {
  onglet: "offre" | "lettre";
  scinde: boolean;
  metiers: string[];
  annexeComplete: boolean;
  nbPrestations: number;
  nbCv: number;
  nbClauses: number;
}) {
  const lignes: React.ReactNode[] =
    onglet === "offre"
      ? [
          "Couverture et sommaire",
          "Présentation du cabinet",
          `Programme des ${nbPrestations} formations`,
          scinde ? <mark key="budget">Budget sur une page dédiée</mark> : "Budget dans le tableau de synthèse",
          `${nbCv} CV insérés`,
          annexeComplete
            ? "Annexe complète (12 pages)"
            : `Annexe : ${metiers.join(", ") || "aucune ligne de métier"}`,
          "Conditions et signatures",
        ]
      : [
          "En-tête et destinataire du fonds",
          "Objet et périmètre de la mission",
          <mark key="clauses">{`Les ${nbClauses} clauses, renumérotées de 1 à ${nbClauses}`}</mark>,
          "Honoraires et indice d'échelle mobile",
          `Mise en page sur ${pagesLettre(nbClauses)} pages`,
          "Signature et acceptation",
        ];

  return (
    <ol
      className="list-decimal space-y-[5px] py-[14px] pl-[34px] pr-[16px] text-[12.5px]"
      style={{ color: "var(--p45-texte-2)" }}
    >
      {lignes.map((l, i) => (
        <li key={i}>{l}</li>
      ))}
    </ol>
  );
}

function CompteRendu({
  rapport,
  messages,
  bloquant,
}: {
  rapport: Rapport;
  messages: Message[];
  bloquant: boolean;
}) {
  return (
    <div
      className="rounded-sm"
      style={{ background: "var(--p45-surface)", border: "1px solid var(--p45-filet)" }}
    >
      <div className="flex items-center gap-2 px-[16px] pb-3 pt-[14px]">
        {rapport.ok ? <Badge ton="ok">Produite</Badge> : <Badge ton="accent">Refusée</Badge>}
        <h2 className="text-[14.5px]" style={{ fontWeight: 650 }}>
          Dernière génération
        </h2>
      </div>
      <ul style={{ borderTop: "1px solid var(--p45-filet)" }} className="space-y-3 p-[16px]">
        {messages.map((m, i) => (
          <li
            key={i}
            className="pl-3"
            style={{
              borderLeft: `3px solid ${
                m.niveau === "BLOQUANT"
                  ? "var(--p45-accent)"
                  : m.niveau === "À MONTRER"
                    ? "var(--p45-attention-filet)"
                    : "var(--p45-filet-fort)"
              }`,
            }}
          >
            <div
              className="text-[10.5px] font-semibold uppercase tracking-[.08em]"
              style={{
                color:
                  m.niveau === "BLOQUANT"
                    ? "var(--p45-accent)"
                    : m.niveau === "À MONTRER"
                      ? "var(--p45-attention-texte)"
                      : "var(--p45-texte-3)",
              }}
            >
              {m.niveau}
            </div>
            <p className="mt-[2px] text-[12.5px]" style={{ color: "var(--p45-texte-2)" }}>
              {m.texte}
            </p>
          </li>
        ))}
        {!rapport.ok ? (
          <li className="text-[12.5px]" style={{ color: "var(--p45-texte-2)" }}>
            {rapport.imputable_saisie
              ? "Corrigez la saisie et relancez."
              : "Contactez l'administrateur de l'application."}
          </li>
        ) : null}
      </ul>
      {rapport.ok && !bloquant ? (
        <div style={{ borderTop: "1px solid var(--p45-filet)" }} className="p-[16px]">
          <a
            href={urlTelechargement(rapport.fichier)}
            className="flex w-full items-center justify-center gap-2 rounded-sm px-3 py-[8px] text-[13.5px] font-semibold"
            style={{ background: "var(--p45-accent)", color: "var(--p45-sur-accent)" }}
          >
            <Download size={14} aria-hidden />
            Télécharger le document
          </a>
        </div>
      ) : null}
    </div>
  );
}
