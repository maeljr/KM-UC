import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import chromadb
from sentence_transformers import SentenceTransformer
from pypdf import PdfReader
import ollama
from openai import AzureOpenAI
from azure.identity import DeviceCodeCredential
import requests
import base64
from collections import defaultdict
import json
import numpy as np
import time
import threading
from rank_bm25 import BM25Okapi
from azure_search import ask_azure, search_azure

# Credential Azure réutilisable (évite le Device Code à chaque appel)
_azure_credential = None

def _get_azure_credential():
    global _azure_credential
    if _azure_credential is None:
        _azure_credential = DeviceCodeCredential(
            tenant_id="hacapartners.onmicrosoft.com",
            client_id="04b07795-8ddb-461a-bbee-02f9e1bf7b46"
        )
    return _azure_credential

# --- CONFIGURATION ---
MODEL_NAME = 'all-MiniLM-L6-v2'
CHROMA_DB_PATH = "./chroma_db"
COLLECTION_NAME = "haca_docs"
OLLAMA_MODEL = "llama3.2:3b"
DOCS_FOLDER = "./docs"

# --- HIÉRARCHIE DES NORMES (force juridique) ---
FORCE_JURIDIQUE_MAP = {
    # Niveau 5 - Force maximale
    ("Règlement", "Commission Européenne"): 5,
    ("Règlement", "Parlement Européen"): 5,
    ("RTS", "Commission Européenne"): 5,
    ("ITS", "Commission Européenne"): 5,
    ("Directive", "Commission Européenne"): 5,
    ("Acte délégué", "Commission Européenne"): 5,
    ("Commission Delegated Regulation (EU)", "Commission Européenne"): 5,
    
    # Niveau 4 - Force forte
    ("Circulaire", "CSSF"): 4,
    
    # Niveau 3 - Force moyenne
    ("Guideline", "EBA"): 3,
    ("Guideline", "ESMA"): 3,
    ("Guideline", "EIOPA"): 3,
    
    # Niveau 2 - Force faible
    ("Q&A", "ESMA"): 2,
    ("Q&A", "EBA"): 2,
    ("Opinion", "ESMA"): 2,
    ("Supervisory Briefing", "ESMA"): 2,
    
    # Niveau 1 - Force minimale
    ("Consultation Paper", ""): 1,
    ("Discussion Paper", ""): 1,
    ("Newsletter", ""): 1,
    ("Rapport", ""): 1,
    ("Autre", ""): 1,
}

EMETTEUR_FORCE_DEFAULT = {
    "Commission Européenne": 5,
    "Parlement Européen": 5,
    "CSSF": 4,
    "CSSF - CPDI": 4,
    "EBA": 3,
    "ESMA": 3,
    "ECB": 3,
    "EIOPA": 3,
}

def get_force_juridique(type_doc: str, emetteur: str) -> int:
    """Retourne la force juridique (1-5) basée sur le type et l'émetteur.
    Aucun nom de fichier en dur : 100% scalable."""
    key = (type_doc, emetteur)
    if key in FORCE_JURIDIQUE_MAP:
        return FORCE_JURIDIQUE_MAP[key]
    if emetteur in EMETTEUR_FORCE_DEFAULT:
        return EMETTEUR_FORCE_DEFAULT[emetteur]
    print(f"  ⚠️ Force juridique inconnue pour type={type_doc}, emetteur={emetteur} → 1 par défaut")
    return 1

# --- CONFIGURATION AZURE ---
AZURE_ENDPOINT = "https://aif-haca-shared-dev.services.ai.azure.com/openai"
AZURE_API_VERSION = "2025-01-01-preview"
AZURE_MODEL_GEN = "gpt-5.6-luna"
AZURE_MODEL_VERIF = "gpt-5.4"
USE_AZURE = True
USE_AZURE_EMBEDDING = True

# --- CONFIGURATION AZURE AI SEARCH ---
AZURE_SEARCH_ENDPOINT = "https://srch-haca-shared-dev.search.windows.net"
AZURE_SEARCH_KEY = os.getenv("AZURE_SEARCH_KEY", "")
AZURE_SEARCH_INDEX = "haca-docs"
USE_AZURE_SEARCH = False

# --- INITIALISATION ---
app = FastAPI(title="HACA Local RAG API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

print(f"Chargement du modèle d'embedding '{MODEL_NAME}'...")
embedding_model = SentenceTransformer(MODEL_NAME)

print("Connexion à ChromaDB...")
chroma_client = chromadb.PersistentClient(path=CHROMA_DB_PATH)

collection = chroma_client.get_or_create_collection(name=COLLECTION_NAME)
print(f"Collection '{COLLECTION_NAME}' prête. {collection.count()} documents indexés.")

# --- INITIALISATION BM25 (index plein texte local) ---
bm25_index = None
bm25_id_to_source = {}
bm25_texts = []
bm25_tokenized = []

def build_bm25_index():
    """Construit un index BM25 à partir de tous les documents dans ChromaDB."""
    global bm25_index, bm25_id_to_source, bm25_texts, bm25_tokenized
    
    all_items = collection.get()
    if not all_items['ids']:
        print("Aucun document dans ChromaDB pour construire l'index BM25.")
        return
    
    bm25_texts = []
    bm25_id_to_source = {}
    bm25_tokenized = []
    
    for i, (doc_id, meta) in enumerate(zip(all_items['ids'], all_items['metadatas'])):
        text = meta.get('text', meta.get('content', ''))
        bm25_texts.append(text)
        bm25_id_to_source[i] = doc_id
        bm25_tokenized.append(text.lower().split())
    
    bm25_index = BM25Okapi(bm25_tokenized)
    print(f"Index BM25 construit : {len(bm25_texts)} documents.")

build_bm25_index()

def hybrid_search(query: str, n_results: int = 30, bm25_weight: float = 0.3):
    """
    Recherche hybride : combine ChromaDB (vectoriel) + BM25 (plein texte).
    - bm25_weight : poids du BM25 dans le score final (0.0 = vectoriel pur, 1.0 = BM25 pur).
    """
    if USE_AZURE_EMBEDDING:
        query_embedding = get_azure_embedding(query)
    else:
        query_embedding = embedding_model.encode(query).tolist()
    
    chroma_results = collection.query(query_embeddings=[query_embedding], n_results=n_results)
    
    tokenized_query = query.lower().split()
    bm25_scores = bm25_index.get_scores(tokenized_query)
    
    bm25_max = max(bm25_scores) if max(bm25_scores) > 0 else 1
    bm25_normalized = bm25_scores / bm25_max
    
    combined_scores = []
    for i, chroma_id in enumerate(chroma_results['ids'][0]):
        chroma_distance = chroma_results['distances'][0][i]
        chroma_score = 1.0 - min(chroma_distance / 2.0, 1.0)
        
        bm25_score = 0.0
        for j, doc_id in bm25_id_to_source.items():
            if doc_id == chroma_id:
                bm25_score = bm25_normalized[j]
                break
        
        combined = (1.0 - bm25_weight) * chroma_score + bm25_weight * bm25_score
        combined_scores.append(combined)
    
    sorted_indices = np.argsort(combined_scores)[::-1]
    
    sorted_ids = [chroma_results['ids'][0][i] for i in sorted_indices]
    sorted_distances = [chroma_results['distances'][0][i] for i in sorted_indices]
    sorted_metadatas = [chroma_results['metadatas'][0][i] for i in sorted_indices]
    
    return {
        'ids': [sorted_ids],
        'distances': [sorted_distances],
        'metadatas': [sorted_metadatas],
        'combined_scores': [float(combined_scores[i]) for i in sorted_indices]
    }


# --- FONCTIONS DU PIPELINE ---

def extract_text_from_pdf(pdf_path):
    """Extrait le texte d'un fichier PDF."""
    text = ""
    try:
        reader = PdfReader(pdf_path)
        for page in reader.pages:
            page_text = page.extract_text()
            if page_text:
                text += page_text + "\n"
    except Exception as e:
        print(f"  -> Erreur extraction {pdf_path}: {e}")
    return text

def chunk_text_fixed(text, chunk_size=400, overlap=75):
    """Découpe le texte en chunks de taille fixe avec chevauchement (en tokens approximatifs)."""
    words = text.split()
    chunks = []
    
    if len(words) <= chunk_size:
        return [text]
    
    step = chunk_size - overlap
    for i in range(0, len(words), step):
        chunk_words = words[i:i + chunk_size]
        if chunk_words:
            chunks.append(" ".join(chunk_words))
        if i + chunk_size >= len(words):
            break
    
    return chunks

def chunk_text_hybride(text, max_chunk_size=500, fixed_size=400, overlap=75, seuil_bascule=3):
    """
    Chunking hybride :
    - Si le paragraph chunking produit ≤ seuil_bascule chunks → fixed-size avec overlap
    - Sinon → paragraph chunking
    """
    paragraphs = text.split('\n\n')
    para_chunks = []
    current_chunk = ""

    for para in paragraphs:
        para = para.strip()
        if not para:
            continue
        if len(para.split()) > max_chunk_size:
            if current_chunk:
                para_chunks.append(current_chunk.strip())
                current_chunk = ""
            words = para.split()
            for i in range(0, len(words), max_chunk_size - 50):
                chunk = " ".join(words[i : i + max_chunk_size])
                para_chunks.append(chunk)
            continue
        if len(current_chunk.split()) + len(para.split()) <= max_chunk_size:
            if current_chunk:
                current_chunk += "\n\n" + para
            else:
                current_chunk = para
        else:
            if current_chunk:
                para_chunks.append(current_chunk.strip())
            current_chunk = para

    if current_chunk:
        para_chunks.append(current_chunk.strip())

    if len(para_chunks) <= seuil_bascule:
        print(f"  → Document court ({len(para_chunks)} chunks paragraph), bascule en fixed-size ({fixed_size} tokens, {overlap} overlap)")
        return chunk_text_fixed(text, chunk_size=fixed_size, overlap=overlap)
    else:
        print(f"  → Document long ({len(para_chunks)} chunks paragraph), conservation du paragraph chunking")
        return para_chunks


def create_azure_search_index():
    """Crée l'index Azure AI Search s'il n'existe pas."""
    import requests
    
    url = f"{AZURE_SEARCH_ENDPOINT}/indexes/{AZURE_SEARCH_INDEX}?api-version=2024-07-01"
    headers = {
        "Content-Type": "application/json",
        "api-key": AZURE_SEARCH_KEY
    }
    
    index_schema = {
        "name": AZURE_SEARCH_INDEX,
        "fields": [
            {"name": "id", "type": "Edm.String", "key": True, "filterable": True},
            {"name": "source", "type": "Edm.String", "filterable": True, "sortable": True},
            {"name": "chunk_index", "type": "Edm.Int32", "filterable": True, "sortable": True},
            {"name": "content", "type": "Edm.String", "searchable": True},
            {"name": "embedding", "type": "Collection(Edm.Single)", "searchable": True, "dimensions": 384, "vectorSearchProfile": "default-profile"}
        ],
        "vectorSearch": {
            "algorithms": [{"name": "default-algorithm", "kind": "hnsw"}],
            "profiles": [{"name": "default-profile", "algorithm": "default-algorithm"}]
        }
    }
    
    check = requests.get(url, headers=headers)
    if check.status_code == 200:
        requests.delete(url, headers=headers)
    
    response = requests.put(url, headers=headers, json=index_schema)
    if response.status_code in [200, 201]:
        print(f"Index '{AZURE_SEARCH_INDEX}' créé avec succès.")
    else:
        print(f"Erreur création index : {response.status_code} - {response.text}")


def index_documents_to_azure(documents):
    """Indexe une liste de documents dans Azure AI Search."""
    import requests
    
    url = f"{AZURE_SEARCH_ENDPOINT}/indexes/{AZURE_SEARCH_INDEX}/docs/index?api-version=2024-07-01"
    headers = {
        "Content-Type": "application/json",
        "api-key": AZURE_SEARCH_KEY
    }
    
    docs = []
    for doc in documents:
        safe_id = base64.urlsafe_b64encode(doc["id"].encode()).decode().rstrip("=")
        docs.append({
            "id": safe_id,
            "source": doc["source"],
            "chunk_index": doc["chunk_index"],
            "content": doc["content"],
            "embedding": doc["embedding"],
            "@search.action": "upload"
        })
    
    body = {"value": docs}
    response = requests.post(url, headers=headers, json=body)
    
    if response.status_code in [200, 201]:
        print(f"{len(docs)} documents indexés avec succès.")
    else:
        print(f"Erreur indexation : {response.status_code} - {response.text}")


def search_azure_index(query_embedding, n_results=5):
    """Recherche dans Azure AI Search par similarité vectorielle."""
    import requests
    
    url = f"{AZURE_SEARCH_ENDPOINT}/indexes/{AZURE_SEARCH_INDEX}/docs/search?api-version=2024-07-01"
    headers = {
        "Content-Type": "application/json",
        "api-key": AZURE_SEARCH_KEY
    }
    
    body = {
        "vectors": [{"value": query_embedding, "fields": "embedding", "k": n_results}],
        "select": "id, source, chunk_index, content",
        "top": n_results
    }
    
    response = requests.post(url, headers=headers, json=body)
    
    if response.status_code == 200:
        data = response.json()
        return data["value"]
    else:
        print(f"Erreur recherche : {response.status_code} - {response.text}")
        return []


def extract_metadata_with_llm(text: str, filename: str) -> dict:
    """Utilise le LLM pour extraire les métadonnées d'un document réglementaire (Ollama local)."""
    
    sample = text[:2000]
    
    prompt = f"""Analyse ce texte réglementaire et extrais les métadonnées au format JSON.
Retourne UNIQUEMENT un objet JSON valide, sans commentaire.

{{
    "title": "titre complet du document",
    "type": "Circulaire|Guideline|Règlement|Directive|Newsletter|Rapport|Autre",
    "emetteur": "CSSF|EBA|ESMA|ECB|Commission Européenne|Autre",
    "theme": "thème principal en français (ex: LCB-FT, Gouvernance, ESG, ICT Risk, Dépôts garantis...)",
    "date_publication": "AAAA ou JJ/MM/AAAA si trouvée",
    "perimetre": "Luxembourg|Europe|International"
}}

Texte :
{sample}

JSON :"""

    try:
        response = ollama.generate(model=OLLAMA_MODEL, prompt=prompt, options={"temperature": 0.0})['response'].strip()
        response = response.replace("```json", "").replace("```", "").strip()
        import json
        metadata = json.loads(response)
        print(f"  → Métadonnées extraites : {metadata.get('title', filename)}")
        return metadata
    except Exception as e:
        print(f"  → Extraction métadonnées échouée pour {filename} : {e}")
        return {
            "title": filename,
            "type": "Autre",
            "emetteur": "Inconnu",
            "theme": "Non classé",
            "date_publication": "",
            "perimetre": ""
        }


# --- PERSISTANCE DES MÉTADONNÉES ---
META_FILE = "./documents_meta.json"

def load_meta():
    """Charge les métadonnées persistées, ou retourne les valeurs par défaut."""
    if os.path.exists(META_FILE):
        try:
            with open(META_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except:
            pass
    return {
        "cssf22_822_annexe_240626.pdf": {"title": "Annexe Circulaire CSSF 22/822", "type": "Circulaire", "emetteur": "CSSF", "theme": "LCB-FT / GAFI", "date_publication": "19 juin 2026", "perimetre": "International"},
        "CSSF_CPDI_2651.pdf": {"title": "Circulaire CSSF-CPDI 26/51", "type": "Circulaire", "emetteur": "CSSF - CPDI", "theme": "Dépôts garantis (FGDL)", "date_publication": "1er juillet 2026", "perimetre": "Luxembourg"},
        "CSSF_CPDI_2650.pdf": {"title": "Circulaire CSSF-CPDI 26/50", "type": "Circulaire", "emetteur": "CSSF - CPDI", "theme": "Dépôts garantis (FGDL)", "date_publication": "26 mars 2026", "perimetre": "Luxembourg"},
        "cssf26_912.pdf": {"title": "Circulaire CSSF 26/912", "type": "Circulaire", "emetteur": "CSSF", "theme": "Abrogation IML 91/75", "date_publication": "22 mai 2026", "perimetre": "Luxembourg"}
    }

def save_meta():
    """Sauvegarde les métadonnées dans le fichier JSON."""
    try:
        with open(META_FILE, "w", encoding="utf-8") as f:
            json.dump(DOCUMENTS_META, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"  → Erreur sauvegarde métadonnées : {e}")


# --- API ENDPOINTS ---

@app.get("/")
def root():
    return {"message": "HACA Local RAG API is running. Use POST /ask to ask a question."}


class IndexRequest(BaseModel):
    filename: str

@app.post("/index")
def index_single(request: IndexRequest):
    filename = request.filename
    if not filename:
        raise HTTPException(status_code=400, detail="Nom de fichier requis")
    filepath = os.path.join(DOCS_FOLDER, filename)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail=f"Fichier {filename} introuvable")
    print(f"Indexation de : {filename}")
    text = extract_text_from_pdf(filepath)
    if not text.strip():
        raise HTTPException(status_code=400, detail="Aucun texte extrait")
    if filename not in DOCUMENTS_META:
        DOCUMENTS_META[filename] = extract_metadata_with_llm(text, filename)
        save_meta()
    chunks = chunk_text_hybride(text)
    print(f"  -> {len(chunks)} chunks créés.")
    for i, chunk in enumerate(chunks):
        chunk_id = f"{filename}_{i}"
        if USE_AZURE_EMBEDDING:
            embedding = get_azure_embedding(chunk)
        else:
            embedding = embedding_model.encode(chunk).tolist()
        collection.upsert(ids=[chunk_id], embeddings=[embedding], metadatas=[{"source": filename, "chunk_index": i, "text": chunk}])
    build_bm25_index()
    return {"status": "ok", "filename": filename, "chunks": len(chunks)}


@app.post("/reindex")
def reindex():
    """Vide la collection et réindexe tout le contenu du dossier docs."""
    existing = collection.get()
    if existing['ids']:
        collection.delete(ids=existing['ids'])
    for filename in os.listdir(DOCS_FOLDER):
        if filename.endswith(".pdf"):
            filepath = os.path.join(DOCS_FOLDER, filename)
            print(f"Traitement de : {filename}")
            text = extract_text_from_pdf(filepath)
            if not text.strip():
                continue
            if filename not in DOCUMENTS_META:
                DOCUMENTS_META[filename] = extract_metadata_with_llm(text, filename)
                save_meta()
            chunks = chunk_text_hybride(text)
            for i, chunk in enumerate(chunks):
                chunk_id = f"{filename}_{i}"
                if USE_AZURE_EMBEDDING:
                    embedding = get_azure_embedding(chunk)
                else:
                    embedding = embedding_model.encode(chunk).tolist()
                collection.upsert(ids=[chunk_id], embeddings=[embedding], metadatas=[{"source": filename, "chunk_index": i, "text": chunk}])
    print("Réindexation terminée.")
    build_bm25_index()
    return {"status": "Réindexation terminée"}


class Question(BaseModel):
    query: str
    lang: str = "fr"


def call_azure_llm(prompt: str, model: str, max_retries: int = 3) -> str:
    """Appelle un modèle LLM sur Azure AI Foundry avec retry automatique en cas de rate limit."""
    
    credential = _get_azure_credential()
    token = credential.get_token("https://cognitiveservices.azure.com/.default").token
    
    url = f"https://aif-haca-shared-dev.services.ai.azure.com/openai/deployments/{model}/chat/completions?api-version=2025-01-01-preview"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    body = {"messages": [{"role": "user", "content": prompt}], "max_completion_tokens": 2000}
    
    for attempt in range(max_retries):
        response = requests.post(url, headers=headers, json=body)
        
        if response.status_code == 429:
            wait_time = (attempt + 1) * 5
            print(f"  ⚠️ Rate limit, nouvelle tentative dans {wait_time}s... (tentative {attempt + 1}/{max_retries})")
            time.sleep(wait_time)
            continue
        
        if response.status_code != 200:
            raise Exception(f"Error code: {response.status_code} - {response.text}")
        
        return response.json()["choices"][0]["message"]["content"].strip()
    
    raise Exception(f"Rate limit persistant après {max_retries} tentatives.")

def get_azure_embedding(text: str) -> list:
    """Vectorise un texte avec text-embedding-3-large via Azure."""
    import os
    import time
    
    credential = _get_azure_credential()
    token = credential.get_token("https://cognitiveservices.azure.com/.default").token
    
    url = "https://aif-haca-shared-dev.services.ai.azure.com/openai/deployments/text-embedding-3-large/embeddings?api-version=2024-10-21"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    body = {"input": [text]}
    
    for attempt in range(5):
        response = requests.post(url, headers=headers, json=body)
        
        if response.status_code == 429:
            wait = 2 * (attempt + 1)
            print(f"  ⚠️ Rate limit embedding, pause {wait}s...")
            time.sleep(wait)
            continue
        
        if response.status_code != 200:
            raise Exception(f"Erreur embedding Azure : {response.status_code} - {response.text}")
        
        return response.json()["data"][0]["embedding"]
    
    raise Exception("Rate limit embedding persistant après 5 tentatives")

# --- MÉTADONNÉES DES DOCUMENTS (chargées depuis le fichier JSON) ---
DOCUMENTS_META = load_meta()
print(f"  → Métadonnées chargées : {len(DOCUMENTS_META)} documents.")


def extract_facts_from_chunks(chunks_text: str, query: str, model: str = None) -> str:
    """Extrait les faits saillants des chunks avec un LLM rapide."""
    if model is None:
        model = AZURE_MODEL_VERIF
    
    extraction_prompt = f"""Pour chaque extrait ci-dessous, extrais UNIQUEMENT les faits pertinents pour répondre à la question.
Ignore le texte non pertinent. Pour chaque fait, indique la source.

Format :
[FAIT] : description du fait | [Source : nom_fichier.pdf]

Question : {query}

Extraits :
{chunks_text}

Faits extraits :"""
    
    try:
        if USE_AZURE:
            return call_azure_llm(extraction_prompt, model)
        else:
            return ollama.generate(model=OLLAMA_MODEL, prompt=extraction_prompt, options={"temperature": 0.0})['response'].strip()
    except Exception as e:
        print(f"  ⚠️ Extraction des faits échouée, utilisation des chunks bruts : {e}")
        return chunks_text

class AzureQuestion(BaseModel):
    query: str
    lang: str = "fr"
    top: int = 8
    business_line: str = None
    library: str = None
    history: list = []

@app.post("/ask-azure")
def ask_azure_endpoint(question: AzureQuestion):
    """Endpoint utilisant Azure AI Search (text-embedding-3-large + GPT-5.4)."""
    try:
        filter_expr = None
        if question.business_line:
            filter_expr = f"businessLine eq '{question.business_line}'"
        if question.library:
            lib_filter = f"library eq '{question.library}'"
            filter_expr = filter_expr + " and " + lib_filter if filter_expr else lib_filter
        
        result = ask_azure(question.query, top=question.top, filter_expr=filter_expr, history=question.history)
        return result
    except Exception as e:
        import traceback
        print("ERREUR dans /ask-azure :")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Erreur Azure AI Search : {str(e)}")

@app.post("/ask")
def ask(question: Question):
    """Pose une question au système RAG avec double vérification asynchrone."""
    query = question.query
    results = hybrid_search(query, n_results=30, bm25_weight=0.5)

    if results['distances'] and results['distances'][0]:
        best_distance = results['distances'][0][0]
        if best_distance > 1.8:
            return {"answer": "Je n'ai trouvé aucun document pertinent.", "confidence": "aucune", "confidence_score": 0, "sources": []}

    if not results['ids'][0]:
        return {"answer": "Je n'ai trouvé aucun document pertinent.", "confidence": "aucune", "confidence_score": 0, "sources": []}

    filtered_metas = []
    filtered_texts = []
    seen_sources = set()
    
    for i, meta in enumerate(results['metadatas'][0]):
        source = meta['source']
        if source not in seen_sources:
            seen_sources.add(source)
            filtered_metas.append(meta)
            filtered_texts.append(f"[Source : {meta['source']}]\n{meta['text']}")
        elif sum(1 for m in filtered_metas if m['source'] == source) < 2:
            filtered_metas.append(meta)
            filtered_texts.append(f"[Source : {meta['source']}]\n{meta['text']}")
        
        if len(filtered_texts) >= 5:
            break

    sources_txt = "\n\n---\n\n".join(filtered_texts)
    
    # Extraction des faits avant génération (avec fallback)
    print(f"  → Extraction des faits avec {AZURE_MODEL_VERIF}...")
    facts = extract_facts_from_chunks(sources_txt, query)
    
    # Fallback : si l'extraction est vide, trop courte, ou a échoué → chunks bruts
    if not facts or len(facts.strip()) < 20 or "extraction des faits échouée" in facts.lower():
        print("  → Fallback : utilisation des chunks bruts pour la génération.")
        facts = sources_txt

    # ========== GÉNÉRATION ==========
    generation_prompt = f"""Tu es un assistant spécialisé en réglementation financière. Réponds UNIQUEMENT à partir des faits extraits ci-dessous. Cite tes sources.
Tu dois répondre en {"français" if question.lang == "fr" else "anglais"}.

RÈGLES :
1. Ne cite QUE des faits présents dans la liste ci-dessous.
2. Si aucun fait pertinent n'est présent, réponds simplement "Cette information n'est pas présente dans les documents fournis." sans citer de sources ni ajouter de commentaires.
3. Cite la source au plus UNE fois à la fin de chaque paragraphe ou point de liste.
4. Après chaque information, ajoute [Source : nom_du_fichier.pdf].

Faits extraits :
{facts}

Question : {query}
Réponse :"""

    try:
        if USE_AZURE:
            generated_answer = call_azure_llm(generation_prompt, AZURE_MODEL_GEN)
        else:
            gen_response = ollama.generate(model=OLLAMA_MODEL, prompt=generation_prompt, options={"temperature": 0.0})
            generated_answer = gen_response['response'].strip()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur lors de la génération : {str(e)}")

        # ========== VÉRIFICATION (synchrone avec timeout) ==========
    import threading

    verification_result = None

    def run_verification():
        nonlocal verification_result
        verification_prompt = f"""Ces extraits soutiennent-ils la réponse ? Réponds uniquement "OUI" ou "NON".
Extraits (résumé) : {sources_txt[:1000]}
Réponse : {generated_answer[:500]}
Vérificateur (OUI/NON) :"""
        try:
            if USE_AZURE and AZURE_MODEL_VERIF:
                verif = call_azure_llm(verification_prompt, AZURE_MODEL_VERIF)
            else:
                verif = ollama.generate(model=OLLAMA_MODEL, prompt=verification_prompt, options={"temperature": 0.0})['response'].strip()
            verification_result = verif.strip().upper()
            print(f"[VÉRIFICATION] {verification_result}")
        except Exception as e:
            print(f"[VÉRIFICATION] Erreur : {e}")
            verification_result = "ERREUR"

    verif_thread = threading.Thread(target=run_verification, daemon=True)
    verif_thread.start()
    verif_thread.join(timeout=5)  # Attendre max 5 secondes

        # ========== SCORE DE CONFIANCE HYBRIDE ==========
    best_distance = results['distances'][0][0] if results['distances'] else 1.5
    
    # Score vectoriel (0-100)
    vector_score = max(0, 100 - int(best_distance * 50))
    
    # Score BM25 (0-100)
    bm25_raw = results.get('combined_scores', [0])[0] if results.get('combined_scores') else 0
    bm25_score = int(bm25_raw * 100)
    
    # Score de vérification
    if verification_result == "OUI":
        verif_score = 100
    elif verification_result == "NON":
        verif_score = 30
    else:
        verif_score = 50  # timeout ou erreur
    
    # Score final pondéré
    confidence_score = int(0.4 * vector_score + 0.3 * bm25_score + 0.3 * verif_score)
    confidence_score = max(0, min(100, confidence_score))
    
    if confidence_score >= 70:
        confidence = "élevée"
    elif confidence_score >= 45:
        confidence = "moyenne"
    elif confidence_score >= 25:
        confidence = "faible"
    else:
        confidence = "très faible"
    
    print(f"  → Scores: vectoriel={vector_score}, BM25={bm25_score}, vérif={verif_score} → final={confidence_score} ({confidence})")

    # ========== ENRICHISSEMENT DES SOURCES ==========
    enriched_sources = []
    for i, meta in enumerate(filtered_metas):
        chunk_distance = results['distances'][0][i] if results['distances'] and i < len(results['distances'][0]) else best_distance
        chunk_score = max(0, min(100, 100 - int(chunk_distance * 50)))
        doc_meta = DOCUMENTS_META.get(meta['source'], {})
        enriched_sources.append({
            "source": meta['source'],
            "chunk_index": meta['chunk_index'],
            "snippet": meta['text'][:500],
            "section": f"Chunk {meta['chunk_index']}",
            "score": chunk_score,
            "force_juridique": get_force_juridique(
                doc_meta.get("type", ""),
                doc_meta.get("emetteur", "")
            ),
            "title": doc_meta.get("title", meta['source']),
            "type_document": doc_meta.get("type", ""),
            "emetteur": doc_meta.get("emetteur", ""),
            "theme": doc_meta.get("theme", ""),
            "date_publication": doc_meta.get("date_publication", ""),
            "perimetre": doc_meta.get("perimetre", "")
        })

    return {
        "answer": generated_answer,
        "confidence": confidence,
        "confidence_score": confidence_score,
        "sources": enriched_sources
    }


# --- DÉMARRAGE (indexation incrémentale) ---
existing_docs = set()
try:
    all_items = collection.get()
    if all_items['metadatas']:
        for meta in all_items['metadatas']:
            existing_docs.add(meta['source'])
except:
    pass

new_docs = []
for filename in os.listdir(DOCS_FOLDER):
    if filename.endswith(".pdf") and filename not in existing_docs:
        new_docs.append(filename)

if new_docs:
    print(f"Indexation de {len(new_docs)} nouveau(x) document(s)...")
    for filename in new_docs:
        filepath = os.path.join(DOCS_FOLDER, filename)
        print(f"Traitement de : {filename}")
        text = extract_text_from_pdf(filepath)
        if not text.strip():
            continue
        if filename not in DOCUMENTS_META:
            DOCUMENTS_META[filename] = extract_metadata_with_llm(text, filename)
            save_meta()
        chunks = chunk_text_hybride(text)
        for i, chunk in enumerate(chunks):
            chunk_id = f"{filename}_{i}"
            if USE_AZURE_EMBEDDING:
                embedding = get_azure_embedding(chunk)
                time.sleep(1)  # pause pour éviter le rate limit
            else:
                embedding = embedding_model.encode(chunk).tolist()
            collection.upsert(ids=[chunk_id], embeddings=[embedding], metadatas=[{"source": filename, "chunk_index": i, "text": chunk}])
    build_bm25_index()
    print("Indexation terminée.")
else:
    print("Aucun nouveau document à indexer.")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)