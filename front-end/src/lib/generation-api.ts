export type Prestation = {
  code: string;
  libelle: string;
  heures: string;
  tag: string;
  couleur: string;
  ligne_metier: string;
};

export type Personne = { code: string; nom: string; fonction: string; mail: string };

export type Clause = { cle: string; titre: string; formes: string[] };

export type Catalogue = {
  prestations: Prestation[];
  intervenants: Personne[];
  signataires: Personne[];
  clauses: Clause[];
};

export type ContexteOffre = {
  CLIENT: string;
  SUJET: string;
  PERSONNE?: string;
  BUDGET?: string;
  LOGO?: string;
  prestations: (Prestation & { intervenants: string[] })[];
  budget?: { heures: string };
  mission?: { langue?: string; date?: string; lieu?: string; formateurs?: string };
  signataire1?: { nom: string; fonction: string };
  signataire2?: { nom: string; fonction: string };
  options?: { annexe_complete?: boolean };
};

export type ContexteLettre = {
  forme: "sicar" | "sif" | "raif";
  FONDS: string;
  fonds?: { adresse?: string; ville?: string };
  DATE: string;
  exercice: { debut: string; fin: string };
  HONORAIRES: string;
  indice?: string;
  signataire: { nom: string; fonction: string };
  clauses?: string[];
};

export type RapportOk = {
  ok: true;
  fichier: string;
  slides?: number;
  clauses?: string[];
  prestations?: string[];
  cv?: string[];
  avertissements: string[];
  balises_non_resolues: string[];
  refus: string[];
  ecarts?: string[];
};

export type RapportErreur = {
  ok: false;
  code:
    | "CONTEXTE_INVALIDE"
    | "PRESTATION_INCONNUE"
    | "INTERVENANT_SANS_CV"
    | "MODELE_INCOMPATIBLE"
    | "FICHIER_INDISPONIBLE"
    | "ERREUR_INTERNE";
  message: string;
  details?: string[];
  imputable_saisie: boolean;
  avertissements: string[];
};

export type Rapport = RapportOk | RapportErreur;

export const BASE = "/api/generation";

export class ServiceInjoignable extends Error {}

async function lire(reponse: Response): Promise<Rapport> {
  const corps = (await reponse.json()) as Rapport;
  return corps;
}

export async function getCatalogue(): Promise<Catalogue> {
  try {
    const reponse = await fetch(`${BASE}/catalogue`);
    if (!reponse.ok) throw new ServiceInjoignable(`statut ${reponse.status}`);
    return (await reponse.json()) as Catalogue;
  } catch (erreur) {
    throw new ServiceInjoignable(String(erreur));
  }
}

async function poster(chemin: string, corps: unknown): Promise<Rapport> {
  let reponse: Response;
  try {
    reponse = await fetch(`${BASE}${chemin}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corps),
    });
  } catch {
    throw new ServiceInjoignable(chemin);
  }
  return lire(reponse);
}

export async function genererOffre(contexte: ContexteOffre): Promise<Rapport> {
  return poster("/offre", contexte);
}

export async function genererLettre(contexte: ContexteLettre): Promise<Rapport> {
  return poster("/lettre", contexte);
}

export async function sante(): Promise<boolean> {
  try {
    const reponse = await fetch(`${BASE}/sante`);
    return reponse.ok;
  } catch {
    return false;
  }
}

export function urlTelechargement(fichier: string): string {
  const nom = fichier.split(/[\\/]/).pop() ?? fichier;
  return `${BASE}/document/${encodeURIComponent(nom)}`;
}

/* ---- Repli hors ligne : uniquement si le service est injoignable ---- */

export const CATALOGUE_REPLI: Catalogue = {
  prestations: [
    { code: "aml", libelle: "One AML/CFT annual training session", heures: "1 to 2", tag: "AML\n/CFT", couleur: "E2003A", ligne_metier: "regulatory" },
    { code: "sanctions", libelle: "Sanctions", heures: "1", tag: "AML\n/CFT", couleur: "E2003A", ligne_metier: "regulatory" },
    { code: "ubo", libelle: "UBO definitions", heures: "1", tag: "AML\n/CFT", couleur: "E2003A", ligne_metier: "regulatory" },
    { code: "board", libelle: "Board responsibilities", heures: "1", tag: "Board", couleur: "7030A0", ligne_metier: "regulatory" },
    { code: "am", libelle: "Authorised management responsibilities", heures: "1", tag: "AM", couleur: "9DD5E8", ligne_metier: "regulatory" },
    { code: "mar", libelle: "Market Abuse", heures: "2", tag: "MAR", couleur: "119DA4", ligne_metier: "regulatory" },
    { code: "risk", libelle: "Risk Management", heures: "3", tag: "RM", couleur: "7030A0", ligne_metier: "risk" },
    { code: "valuation", libelle: "Valuation", heures: "4", tag: "VAL", couleur: "9DD5E8", ligne_metier: "consulting" },
    { code: "overview", libelle: "Global Overview Core training", heures: "1 to 2", tag: "REG", couleur: "1B3A5C", ligne_metier: "regulatory" },
    { code: "pm_oversight", libelle: "Portfolio management oversight", heures: "2", tag: "PM", couleur: "119DA4", ligne_metier: "regulatory" },
    { code: "compliance", libelle: "Compliance", heures: "2", tag: "CMP", couleur: "E2003A", ligne_metier: "regulatory" },
  ],
  intervenants: [
    { code: "aleroy", nom: "Alice LEROY", fonction: "Partner", mail: "aleroy@exemple.lu" },
    { code: "cdupont", nom: "Camille DUPONT", fonction: "Director", mail: "cdupont@exemple.lu" },
    { code: "mnoel", nom: "Marc NOEL", fonction: "Senior Manager", mail: "mnoel@exemple.lu" },
    { code: "sfaber", nom: "Sofia FABER", fonction: "Manager", mail: "sfaber@exemple.lu" },
  ],
  signataires: [
    { code: "aleroy", nom: "Alice LEROY", fonction: "Partner", mail: "aleroy@exemple.lu" },
    { code: "cdupont", nom: "Camille DUPONT", fonction: "Director", mail: "cdupont@exemple.lu" },
  ],
  clauses: [
    { cle: "scope", titre: "Scope of the audit", formes: ["sicar", "sif", "raif"] },
    { cle: "communication", titre: "Communication of audit matters", formes: ["sicar", "sif", "raif"] },
    { cle: "audit_report", titre: "Audit report", formes: ["sicar", "sif", "raif"] },
    { cle: "management_letter", titre: "Management letter", formes: ["sif"] },
    { cle: "written_representations", titre: "Written representations", formes: ["sicar", "sif", "raif"] },
    { cle: "cssf_circular", titre: "CSSF Circular 11/503", formes: ["sicar", "sif"] },
    { cle: "professional_secrecy", titre: "Professional secrecy", formes: ["sicar", "sif", "raif"] },
    { cle: "protection_donnees", titre: "Protection of personal data", formes: ["sicar", "sif", "raif"] },
    { cle: "translation", titre: "Translation of the FS into other languages", formes: ["raif"] },
    { cle: "abridged", titre: "Abridged or amended version of the FS", formes: ["raif"] },
    { cle: "fees", titre: "Fees", formes: ["sicar", "sif", "raif"] },
    { cle: "non_assignment", titre: "Non-assignment", formes: ["sicar", "raif"] },
    { cle: "independent_contractor", titre: "Independent contractor", formes: ["sicar", "raif"] },
    { cle: "force_majeure", titre: "Force majeure", formes: ["sicar", "sif", "raif"] },
    { cle: "severance", titre: "Severance of terms", formes: ["sicar", "sif", "raif"] },
    { cle: "entire_agreement", titre: "Entire agreement", formes: ["sicar", "sif", "raif"] },
    { cle: "duration", titre: "Duration of our engagement", formes: ["sicar", "sif", "raif"] },
    { cle: "human_rights", titre: "Respect for human rights", formes: ["sicar", "sif", "raif"] },
    { cle: "acceptance", titre: "Acceptance", formes: ["sicar", "sif", "raif"] },
  ],
};
