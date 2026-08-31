import type { Prestation, Rapport } from "./generation-api";

export type Bornes = { bas: number; haut: number };

export function parseHeures(heures: string): Bornes {
  const nombres = heures.match(/\d+([.,]\d+)?/g)?.map((n) => Number(n.replace(",", "."))) ?? [];
  if (nombres.length === 0) return { bas: 0, haut: 0 };
  if (nombres.length === 1) return { bas: nombres[0]!, haut: nombres[0]! };
  return { bas: nombres[0]!, haut: nombres[nombres.length - 1]! };
}

export function totalHeures(prestations: Prestation[]): Bornes {
  return prestations.reduce<Bornes>(
    (acc, p) => {
      const b = parseHeures(p.heures);
      return { bas: acc.bas + b.bas, haut: acc.haut + b.haut };
    },
    { bas: 0, haut: 0 },
  );
}

export function heuresAffichees(prestations: Prestation[]): string {
  const { bas, haut } = totalHeures(prestations);
  return bas === haut ? `${bas} h` : `${bas} à ${haut} h`;
}

export function heuresServeur(prestations: Prestation[]): string {
  const { bas, haut } = totalHeures(prestations);
  return bas === haut ? `${bas}` : `${bas} to ${haut}`;
}

export function tableauScinde(nbPrestations: number): boolean {
  return nbPrestations > 6;
}

export function lignesMetier(prestations: Prestation[]): string[] {
  return Array.from(new Set(prestations.map((p) => p.ligne_metier)));
}

export function pagesAnnexe(prestations: Prestation[], annexeComplete: boolean): number {
  return annexeComplete ? 3 : lignesMetier(prestations).length;
}

export function cvDistincts(
  prestations: Prestation[],
  intervenantsParPrestation: Record<string, string[]>,
): string[] {
  const set = new Set<string>();
  for (const p of prestations) {
    for (const code of intervenantsParPrestation[p.code] ?? []) set.add(code);
  }
  return Array.from(set);
}

export function slidesEstimes(args: {
  prestations: Prestation[];
  nbCv: number;
  annexeComplete: boolean;
}): number {
  const { prestations, nbCv, annexeComplete } = args;
  return (
    18 +
    prestations.length +
    nbCv +
    (tableauScinde(prestations.length) ? 1 : 0) +
    pagesAnnexe(prestations, annexeComplete)
  );
}

export function pagesLettre(nbClauses: number): number {
  return Math.max(6, 5 + Math.round(nbClauses * 0.7));
}

/* -------- Classement des messages du compte rendu -------- */

export type Niveau = "JOURNALISÉ" | "À MONTRER" | "BLOQUANT";
export type Message = { niveau: Niveau; texte: string };

const MOTS_A_MONTRER = ["introuvable", "MANQUANTE", "aucune version propre", "RETIREES", "ajoutees"];

function estAMontrer(avertissement: string): boolean {
  return MOTS_A_MONTRER.some((mot) => avertissement.includes(mot));
}

export function classerRapport(rapport: Rapport): Message[] {
  if (!rapport.ok) {
    const messages: Message[] = [{ niveau: "BLOQUANT", texte: rapport.message }];
    for (const detail of rapport.details ?? []) messages.push({ niveau: "BLOQUANT", texte: detail });
    for (const a of rapport.avertissements) messages.push({ niveau: "BLOQUANT", texte: a });
    return messages;
  }

  const messages: Message[] = [];
  for (const balise of rapport.balises_non_resolues) {
    messages.push({
      niveau: "BLOQUANT",
      texte: `Le champ ${balise} est resté vide et se verrait sur le document livré.`,
    });
  }
  for (const refus of rapport.refus) messages.push({ niveau: "BLOQUANT", texte: refus });
  for (const a of rapport.avertissements) {
    messages.push({ niveau: estAMontrer(a) ? "À MONTRER" : "JOURNALISÉ", texte: a });
  }
  for (const ecart of rapport.ecarts ?? []) messages.push({ niveau: "À MONTRER", texte: ecart });
  return messages;
}

export function contientBloquant(messages: Message[]): boolean {
  return messages.some((m) => m.niveau === "BLOQUANT");
}
