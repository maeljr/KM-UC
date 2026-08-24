#!/usr/bin/env python3
"""
Connexion entre l'index Azure AI Search et le RAG.

Deux fonctions a importer dans votre backend :

    from rag_retrieve import retrieve, answer

    passages = retrieve("qui est le beneficiaire effectif")
    resultat = answer("qui est le beneficiaire effectif")
    # -> {"answer": ..., "sources": [...], "grounded": True/False}

Test en ligne de commande :
    python rag_retrieve.py "qui est le beneficiaire effectif"
    python rag_retrieve.py "obligations de vigilance" --business-line Compliance

Variables d'environnement (les memes que rag_ingest.py) :
    AZURE_AI_ENDPOINT, AZURE_AI_KEY, SEARCH_ENDPOINT, SEARCH_INDEX, SEARCH_API_KEY
"""

import json
import os
import re
import sys

import requests

EMBED_DEPLOYMENT = os.environ.get("EMBED_DEPLOYMENT", "text-embedding-3-large")
CHAT_DEPLOYMENT = os.environ.get("CHAT_DEPLOYMENT", "gpt-5.4")
API_VERSION = os.environ.get("API_VERSION", "2024-10-21")
SEARCH_API_VERSION = "2024-07-01"
SEMANTIC_CONFIG = os.environ.get("SEMANTIC_CONFIG", "config-semantique")

TOP_K = 8            # passages transmis au modele
VECTOR_K = 50        # candidats ramenes par la recherche vectorielle
MAX_CONTEXT_CHARS = 24000

SELECT = ("id,parentId,name,url,content,chunkIndex,"
          "documentType,businessLine,primaryTopic,tags,library")

# Le RAG ne doit jamais inventer : sans contexte, il le dit.
FALLBACK = ("Je n'ai pas trouve d'element dans la base documentaire permettant "
            "de repondre a cette question.")

SYSTEM_PROMPT = """Tu es l'assistant documentaire de HACA Partners.

Regles imperatives :
1. Reponds UNIQUEMENT a partir des extraits fournis. N'utilise aucune connaissance externe.
2. Cite tes sources en indiquant leur numero entre crochets, par exemple [1] ou [2][3].
3. Si les extraits ne permettent pas de repondre, dis-le explicitement sans tenter de deviner.
4. Ne cite jamais un numero d'article, de reglement ou de directive qui n'apparait pas
   litteralement dans les extraits.
5. Reponds dans la langue de la question, meme si les extraits sont dans une autre langue.
6. Structure ta reponse de facon concise, en puces si plusieurs points."""


def _cfg():
    c = {
        "ai": os.environ.get("AZURE_AI_ENDPOINT", "").rstrip("/"),
        "ai_key": os.environ.get("AZURE_AI_KEY", ""),
        "search": os.environ.get("SEARCH_ENDPOINT", "").rstrip("/"),
        "index": os.environ.get("SEARCH_INDEX", "indexdocuments-chunks"),
        "search_key": os.environ.get("SEARCH_API_KEY", ""),
    }
    absents = [k for k in ("ai", "ai_key", "search", "search_key") if not c[k]]
    if absents:
        raise RuntimeError("Variables d'environnement manquantes : " + ", ".join(absents))
    return c


def embed(question, cfg=None):
    cfg = cfg or _cfg()
    url = (f"{cfg['ai']}/openai/deployments/{EMBED_DEPLOYMENT}"
           f"/embeddings?api-version={API_VERSION}")
    r = requests.post(url, headers={"Content-Type": "application/json",
                                    "api-key": cfg["ai_key"]},
                      json={"input": [question]}, timeout=60)
    if r.status_code != 200:
        raise RuntimeError(f"embeddings HTTP {r.status_code}: {r.text[:300]}")
    return r.json()["data"][0]["embedding"]


def _odata_filter(business_line=None, library=None, document_type=None, extra=None):
    """Cloisonnement : restreindre la recherche a un perimetre donne."""
    clauses = []
    for champ, valeur in (("businessLine", business_line),
                          ("library", library),
                          ("documentType", document_type)):
        if valeur:
            clauses.append(f"{champ} eq '{str(valeur).replace(chr(39), chr(39) * 2)}'")
    if extra:
        clauses.append(f"({extra})")
    return " and ".join(clauses) or None


def retrieve(question, top=TOP_K, business_line=None, library=None,
             document_type=None, extra_filter=None, cfg=None):
    """Recherche hybride : vecteurs + mots-cles, puis reclassement semantique.

    L'hybride vaut mieux que le vectoriel seul : les embeddings captent le sens
    mais sont faibles sur les dates, les montants et les references chiffrees,
    que la recherche par mots-cles retrouve exactement.
    """
    cfg = cfg or _cfg()
    vecteur = embed(question, cfg)
    url = (f"{cfg['search']}/indexes/{cfg['index']}"
           f"/docs/search?api-version={SEARCH_API_VERSION}")
    entetes = {"Content-Type": "application/json", "api-key": cfg["search_key"]}

    corps = {
        "search": question,
        "vectorQueries": [{"kind": "vector", "vector": vecteur,
                           "fields": "contentVector", "k": VECTOR_K}],
        "top": top,
        "select": SELECT,
    }
    filtre = _odata_filter(business_line, library, document_type, extra_filter)
    if filtre:
        corps["filter"] = filtre

    # Le reclassement semantique demande un niveau de service qui le supporte.
    # S'il est refuse, on retombe sur l'hybride simple sans casser la requete.
    avec_semantique = dict(corps, queryType="semantic",
                           semanticConfiguration=SEMANTIC_CONFIG)
    r = requests.post(url, headers=entetes, json=avec_semantique, timeout=90)
    if r.status_code != 200:
        r = requests.post(url, headers=entetes, json=corps, timeout=90)
        if r.status_code != 200:
            raise RuntimeError(f"recherche HTTP {r.status_code}: {r.text[:400]}")

    passages = []
    for d in r.json().get("value", []):
        passages.append({
            "id": d.get("id"),
            "name": d.get("name"),
            "url": d.get("url"),
            "content": (d.get("content") or "").strip(),
            "chunkIndex": d.get("chunkIndex"),
            "library": d.get("library"),
            "documentType": d.get("documentType"),
            "businessLine": d.get("businessLine"),
            "primaryTopic": d.get("primaryTopic"),
            "tags": d.get("tags") or [],
            "score": d.get("@search.score"),
            "reranker": d.get("@search.rerankerScore"),
        })
    return passages


def _build_context(passages):
    morceaux, total = [], 0
    retenus = []
    for i, p in enumerate(passages, 1):
        bloc = f"[{i}] Document : {p['name']}\n{p['content']}"
        if total + len(bloc) > MAX_CONTEXT_CHARS:
            break
        morceaux.append(bloc)
        retenus.append(p)
        total += len(bloc)
    return "\n\n---\n\n".join(morceaux), retenus


def answer(question, passages=None, cfg=None, **kw):
    """Genere une reponse ancree dans les extraits, avec ses sources.

    Retourne {"answer", "sources", "grounded", "cited"}.
    grounded=False signifie qu'aucun extrait pertinent n'a ete trouve : la
    reponse est alors le message de repli, jamais une invention.
    """
    cfg = cfg or _cfg()
    if passages is None:
        passages = retrieve(question, cfg=cfg, **kw)

    if not passages:
        return {"answer": FALLBACK, "sources": [], "grounded": False, "cited": []}

    contexte, retenus = _build_context(passages)
    url = (f"{cfg['ai']}/openai/deployments/{CHAT_DEPLOYMENT}"
           f"/chat/completions?api-version={API_VERSION}")
    corps = {
        "temperature": 0.0,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user",
             "content": f"Extraits de la base documentaire :\n\n{contexte}\n\n"
                        f"Question : {question}"},
        ],
    }
    r = requests.post(url, headers={"Content-Type": "application/json",
                                    "api-key": cfg["ai_key"]},
                      json=corps, timeout=180)
    if r.status_code != 200:
        # certains deploiements refusent temperature
        corps.pop("temperature", None)
        r = requests.post(url, headers={"Content-Type": "application/json",
                                        "api-key": cfg["ai_key"]},
                          json=corps, timeout=180)
        if r.status_code != 200:
            raise RuntimeError(f"generation HTTP {r.status_code}: {r.text[:300]}")

    texte = r.json()["choices"][0]["message"]["content"].strip()

    # numeros effectivement cites, pour n'afficher que les sources utilisees
    cites = sorted({int(n) for n in re.findall(r"\[(\d+)\]", texte)
                    if 1 <= int(n) <= len(retenus)})
    sources = []
    for n in cites:
        p = retenus[n - 1]
        sources.append({"n": n, "name": p["name"], "url": p["url"],
                        "library": p["library"], "chunkIndex": p["chunkIndex"]})

    return {"answer": texte, "sources": sources, "grounded": bool(cites),
            "cited": cites, "passages": retenus}


# --- Exemple d'integration FastAPI ----------------------------------------
# A coller dans votre backend, port 8001 :
#
#   from fastapi import FastAPI
#   from pydantic import BaseModel
#   from rag_retrieve import answer
#
#   app = FastAPI()
#
#   class Question(BaseModel):
#       question: str
#       business_line: str | None = None
#       library: str | None = None
#
#   @app.post("/ask")
#   def ask(q: Question):
#       return answer(q.question, business_line=q.business_line, library=q.library)


def main():
    import argparse
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("question")
    ap.add_argument("--top", type=int, default=TOP_K)
    ap.add_argument("--business-line", default=None)
    ap.add_argument("--library", default=None)
    ap.add_argument("--document-type", default=None)
    ap.add_argument("--passages-only", action="store_true",
                    help="afficher les extraits sans generer de reponse")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()

    kw = dict(top=a.top, business_line=a.business_line,
              library=a.library, document_type=a.document_type)

    if a.passages_only:
        ps = retrieve(a.question, **kw)
        if a.json:
            print(json.dumps(ps, ensure_ascii=False, indent=2))
            return
        for i, p in enumerate(ps, 1):
            print(f"\n[{i}] {p['name']}  (bloc {p['chunkIndex']}, {p['library']})")
            print("   " + " ".join(p["content"].split())[:300])
        return

    res = answer(a.question, **kw)
    if a.json:
        res.pop("passages", None)
        print(json.dumps(res, ensure_ascii=False, indent=2))
        return

    print("=" * 78)
    print(res["answer"])
    print("=" * 78)
    if res["sources"]:
        print("\nSources :")
        for s in res["sources"]:
            print(f"  [{s['n']}] {s['name']}  ({s['library']})")
            if s["url"]:
                print(f"       {s['url']}")
    else:
        print("\nAucune source citee : reponse non ancree, a ne pas diffuser.")


if __name__ == "__main__":
    main()
