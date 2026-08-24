"""
Module Azure AI Search pour le backend HACA RAG.
S'inspire de rag_retrieve.py avec ajout de :
- score de confiance normalisé (0-100)
- métadonnées enrichies (force juridique, type, émetteur)
- fallback propre
- structure de réponse compatible avec notre front-end
"""

import os
import re
import requests
import time
from azure.identity import DeviceCodeCredential

_credential = None

def _get_credential():
    global _credential
    if _credential is None:
        _credential = DeviceCodeCredential(
            tenant_id="hacapartners.onmicrosoft.com",
            client_id="04b07795-8ddb-461a-bbee-02f9e1bf7b46"
        )
    return _credential

# Configuration depuis l'environnement
AZURE_AI_ENDPOINT = os.getenv("AZURE_AI_ENDPOINT", "https://aif-haca-shared-dev.services.ai.azure.com")
AZURE_AI_KEY = os.getenv("AZURE_AI_KEY", "")
SEARCH_ENDPOINT = os.getenv("SEARCH_ENDPOINT", "https://srch-haca-shared-dev.search.windows.net")
SEARCH_INDEX = os.getenv("SEARCH_INDEX", "indexdocuments-chunks")
SEARCH_API_KEY = os.getenv("SEARCH_API_KEY", "")

EMBED_DEPLOYMENT = os.getenv("EMBED_DEPLOYMENT", "text-embedding-3-large")
CHAT_DEPLOYMENT = os.getenv("CHAT_DEPLOYMENT", "gpt-5.4")
API_VERSION = "2024-10-21"
SEARCH_API_VERSION = "2024-07-01"

TOP_K = 8
VECTOR_K = 50
MAX_CONTEXT_CHARS = 24000

FALLBACK = "Je n'ai pas trouvé d'élément dans la base documentaire permettant de répondre à cette question."

SYSTEM_PROMPT = """Tu es l'assistant documentaire de HACA Partners.

Règles impératives :
1. Réponds UNIQUEMENT à partir des extraits fournis. N'utilise aucune connaissance externe.
2. Cite tes sources en indiquant leur numéro entre crochets, par exemple [1] ou [2][3].
3. Si les extraits ne permettent pas de répondre, dis-le explicitement sans tenter de deviner.
4. Ne cite jamais un numéro d'article, de règlement ou de directive qui n'apparaît pas littéralement dans les extraits.
5. Réponds dans la langue de la question, même si les extraits sont dans une autre langue.
6. Structure ta réponse de façon concise, en puces si plusieurs points.
7. Si la question demande une information en temps réel (cours de bourse, actualité, date du jour), réponds que tu ne peux pas fournir ce type d'information car ta base documentaire est statique."""


def _get_embedding(question: str) -> list:
    credential = _get_credential()
    token = credential.get_token("https://cognitiveservices.azure.com/.default").token
    url = f"{AZURE_AI_ENDPOINT}/openai/deployments/{EMBED_DEPLOYMENT}/embeddings?api-version={API_VERSION}"
    r = requests.post(
        url,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"input": [question]},
        timeout=60
    )
    if r.status_code != 200:
        raise RuntimeError(f"Embedding HTTP {r.status_code}: {r.text[:300]}")
    return r.json()["data"][0]["embedding"]


def search_azure(question: str, top: int = TOP_K, filter_expr: str = None) -> list:
    """Recherche hybride dans Azure AI Search avec reclassement sémantique."""
    vector = _get_embedding(question)
    url = f"{SEARCH_ENDPOINT}/indexes/{SEARCH_INDEX}/docs/search?api-version={SEARCH_API_VERSION}"
    headers = {"Content-Type": "application/json", "api-key": SEARCH_API_KEY}
    
    body = {
        "search": question,
        "vectorQueries": [{"kind": "vector", "vector": vector, "fields": "contentVector", "k": VECTOR_K}],
        "top": top,
        "select": "id,parentId,name,url,content,chunkIndex,documentType,businessLine,primaryTopic,tags,library",
    }
    if filter_expr:
        body["filter"] = filter_expr
    
    # Tenter avec le reclassement sémantique
    body_sem = dict(body, queryType="semantic", semanticConfiguration="config-semantique")
    r = requests.post(url, headers=headers, json=body_sem, timeout=90)
    if r.status_code != 200:
        # Fallback sans sémantique
        r = requests.post(url, headers=headers, json=body, timeout=90)
        if r.status_code != 200:
            raise RuntimeError(f"Recherche HTTP {r.status_code}: {r.text[:400]}")
    
    passages = []
    for d in r.json().get("value", []):
        passages.append({
            "id": d.get("id"),
            "parentId": d.get("parentId"),
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


def _build_context(passages: list):
    """Construit le contexte pour le LLM avec numérotation."""
    morceaux, total, retenus = [], 0, []
    for i, p in enumerate(passages, 1):
        bloc = f"[{i}] Document : {p['name']}\n{p['content']}"
        if total + len(bloc) > MAX_CONTEXT_CHARS:
            break
        morceaux.append(bloc)
        retenus.append(p)
        total += len(bloc)
    return "\n\n---\n\n".join(morceaux), retenus


def generate_answer(question: str, passages: list, history: list = None):
    """Génère une réponse à partir des passages Azure AI Search."""
    if not passages:
        return {
            "answer": FALLBACK,
            "sources": [],
            "confidence": "aucune",
            "confidence_score": 0,
            "grounded": False,
        }

    # Seuil de pertinence : si le meilleur reranker est trop bas, on refuse de répondre
    best_reranker = max((p.get("reranker") or 0) for p in passages)
    if best_reranker < 2.0:
        return {
            "answer": "Je n'ai pas trouvé d'élément suffisamment pertinent dans la base documentaire pour répondre à cette question.",
            "sources": [],
            "confidence": "aucune",
            "confidence_score": 0,
            "grounded": False,
        }
    
    contexte, retenus = _build_context(passages)
    
    # Construire l'historique conversationnel
    history_text = ""
    if history:
        for msg in history:
            role = "Utilisateur" if msg.get("role") == "user" else "Assistant"
            history_text += f"{role} : {msg.get('content', '')}\n"
    
    url = f"{AZURE_AI_ENDPOINT}/openai/deployments/{CHAT_DEPLOYMENT}/chat/completions?api-version={API_VERSION}"
    corps = {
        "temperature": 0.0,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"Historique de la conversation :\n{history_text}\n\nExtraits de la base documentaire :\n\n{contexte}\n\nQuestion : {question}"},
        ],
    }
    
    credential = _get_credential()
    token = credential.get_token("https://cognitiveservices.azure.com/.default").token
    
    max_retries = 3
    for attempt in range(max_retries):
        credential = _get_credential()
        token = credential.get_token("https://cognitiveservices.azure.com/.default").token
        r = requests.post(url, headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"}, json=corps, timeout=180)
        
        if r.status_code == 429:
            wait_time = (attempt + 1) * 5
            print(f"  ⚠️ Rate limit GPT-5.4, nouvelle tentative dans {wait_time}s...")
            time.sleep(wait_time)
            continue
        
        if r.status_code == 200:
            break
        
        if r.status_code == 400 and "temperature" in corps:
            corps.pop("temperature", None)
            continue
        
        raise RuntimeError(f"Génération HTTP {r.status_code}: {r.text[:300]}")
    
    if r.status_code != 200:
        raise RuntimeError(f"Génération HTTP {r.status_code} après {max_retries} tentatives")
    
    texte = r.json()["choices"][0]["message"]["content"].strip()
    
    # Extraire les numéros cités
    cites = sorted({int(n) for n in re.findall(r"\[(\d+)\]", texte) if 1 <= int(n) <= len(retenus)})
    sources = []
    for n in cites:
        p = retenus[n - 1]
        sources.append({
            "source": p["name"],
            "url": p["url"],
            "library": p["library"],
            "chunk_index": p["chunkIndex"],
            "snippet": p["content"][:500],
            "document_type": p.get("documentType") or "",
            "business_line": p.get("businessLine") or "",
            "primary_topic": p.get("primaryTopic") or "",
            "tags": p.get("tags") or [],
            "citation": n,
        })
    
    # Score de confiance basé sur le reranker moyen des passages cités
    if cites:
        reranker_scores = [retenus[n-1].get("reranker") or 0 for n in cites]
        avg_reranker = sum(reranker_scores) / len(reranker_scores)
        confidence_score = min(95, max(5, int(avg_reranker * 20)))
    else:
        confidence_score = 5
    
    if confidence_score >= 70:
        confidence = "élevée"
    elif confidence_score >= 45:
        confidence = "moyenne"
    elif confidence_score >= 25:
        confidence = "faible"
    else:
        confidence = "très faible"
    
    return {
        "answer": texte,
        "sources": sources,
        "confidence": confidence,
        "confidence_score": confidence_score,
        "grounded": bool(cites),
        "cited": cites,
    }

def ask_azure(question: str, top: int = TOP_K, filter_expr: str = None, history: list = None) -> dict:
    passages = search_azure(question, top=top, filter_expr=filter_expr)
    return generate_answer(question, passages, history=history)