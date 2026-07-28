import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import chromadb
from sentence_transformers import SentenceTransformer
from pypdf import PdfReader
import ollama
import threading
from openai import AzureOpenAI
from azure.identity import DeviceCodeCredential
import requests
import base64

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

# --- CONFIGURATION AZURE ---
AZURE_ENDPOINT = "https://aif-haca-shared-dev.services.ai.azure.com/openai"
AZURE_API_VERSION = "2025-01-01-preview"
AZURE_MODEL_GEN = "gpt-5.6-luna"
AZURE_MODEL_VERIF = "gpt-5-mini"
USE_AZURE = True
USE_AZURE_EMBEDDING = True  # Mettre à True pour utiliser embed-multilingual-v3

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

# Supprimer l'ancienne collection si elle existe (changement de dimension d'embedding)
try:
    chroma_client.delete_collection(name=COLLECTION_NAME)
    print(f"Ancienne collection '{COLLECTION_NAME}' supprimée.")
except:
    pass

collection = chroma_client.get_or_create_collection(name=COLLECTION_NAME)
print("Prêt. L'API est démarrée.")


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


def chunk_text(text, max_chunk_size=500):
    """Découpe le texte par paragraphes, puis fusionne si nécessaire."""
    paragraphs = text.split('\n\n')
    chunks = []
    current_chunk = ""

    for para in paragraphs:
        para = para.strip()
        if not para:
            continue
        if len(para.split()) > max_chunk_size:
            if current_chunk:
                chunks.append(current_chunk.strip())
                current_chunk = ""
            words = para.split()
            for i in range(0, len(words), max_chunk_size - 50):
                chunk = " ".join(words[i : i + max_chunk_size])
                chunks.append(chunk)
            continue
        if len(current_chunk.split()) + len(para.split()) <= max_chunk_size:
            if current_chunk:
                current_chunk += "\n\n" + para
            else:
                current_chunk = para
        else:
            if current_chunk:
                chunks.append(current_chunk.strip())
            current_chunk = para

    if current_chunk:
        chunks.append(current_chunk.strip())

    return chunks


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
    chunks = chunk_text(text)
    print(f"  -> {len(chunks)} chunks créés.")
    for i, chunk in enumerate(chunks):
        chunk_id = f"{filename}_{i}"
        if USE_AZURE_EMBEDDING:
            embedding = get_azure_embedding(chunk)
        else:
            embedding = embedding_model.encode(chunk).tolist()
        collection.upsert(ids=[chunk_id], embeddings=[embedding], metadatas=[{"source": filename, "chunk_index": i, "text": chunk}])
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
            chunks = chunk_text(text)
            for i, chunk in enumerate(chunks):
                chunk_id = f"{filename}_{i}"
                if USE_AZURE_EMBEDDING:
                    embedding = get_azure_embedding(chunk)
                else:
                    embedding = embedding_model.encode(chunk).tolist()
                collection.upsert(ids=[chunk_id], embeddings=[embedding], metadatas=[{"source": filename, "chunk_index": i, "text": chunk}])
    print("Réindexation terminée.")
    return {"status": "Réindexation terminée"}


class Question(BaseModel):
    query: str
    lang: str = "fr"


def call_azure_llm(prompt: str, model: str) -> str:
    """Appelle un modèle LLM sur Azure AI Foundry avec Device Code."""
    
    credential = _get_azure_credential()
    token = credential.get_token("https://cognitiveservices.azure.com/.default").token
    
    url = f"https://aif-haca-shared-dev.services.ai.azure.com/openai/deployments/{model}/chat/completions?api-version=2025-01-01-preview"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    body = {"messages": [{"role": "user", "content": prompt}], "max_completion_tokens": 2000}
    
    response = requests.post(url, headers=headers, json=body)
    if response.status_code != 200:
        raise Exception(f"Error code: {response.status_code} - {response.text}")
    return response.json()["choices"][0]["message"]["content"].strip()

def get_azure_embedding(text: str) -> list:
    """Vectorise un texte avec embed-multilingual-v3 via Azure."""
    import requests
    
    credential = _get_azure_credential()
    token = credential.get_token("https://cognitiveservices.azure.com/.default").token
    
    url = "https://aif-haca-shared-dev.services.ai.azure.com/openai/deployments/embed-multilingual-v3/embeddings?api-version=2025-01-01-preview"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    body = {
        "input": [text]
    }
    
    response = requests.post(url, headers=headers, json=body)
    
    if response.status_code != 200:
        raise Exception(f"Erreur embedding Azure : {response.status_code} - {response.text}")
    
    return response.json()["data"][0]["embedding"]

# --- MÉTADONNÉES DES DOCUMENTS ---
DOCUMENTS_META = {
    "cssf22_822_annexe_240626.pdf": {"title": "Annexe Circulaire CSSF 22/822", "type": "Circulaire", "emetteur": "CSSF", "theme": "LCB-FT / GAFI", "date_publication": "19 juin 2026", "perimetre": "International"},
    "CSSF_CPDI_2651.pdf": {"title": "Circulaire CSSF-CPDI 26/51", "type": "Circulaire", "emetteur": "CSSF - CPDI", "theme": "Dépôts garantis (FGDL)", "date_publication": "1er juillet 2026", "perimetre": "Luxembourg"},
    "CSSF_CPDI_2650.pdf": {"title": "Circulaire CSSF-CPDI 26/50", "type": "Circulaire", "emetteur": "CSSF - CPDI", "theme": "Dépôts garantis (FGDL)", "date_publication": "26 mars 2026", "perimetre": "Luxembourg"},
    "cssf26_912.pdf": {"title": "Circulaire CSSF 26/912", "type": "Circulaire", "emetteur": "CSSF", "theme": "Abrogation IML 91/75", "date_publication": "22 mai 2026", "perimetre": "Luxembourg"}
}


@app.post("/ask")
def ask(question: Question):
    """Pose une question au système RAG avec double vérification asynchrone."""
    query = question.query
    if USE_AZURE_EMBEDDING:
        query_embedding = get_azure_embedding(query)
    else:
        query_embedding = embedding_model.encode(query).tolist()

    results = collection.query(query_embeddings=[query_embedding], n_results=20)

    if results['distances'] and results['distances'][0]:
        best_distance = results['distances'][0][0]
        if best_distance > 1.35:
            return {"answer": "Je n'ai trouvé aucun document pertinent.", "confidence": "aucune", "confidence_score": 0, "sources": []}

    if not results['ids'][0]:
        return {"answer": "Je n'ai trouvé aucun document pertinent.", "confidence": "aucune", "confidence_score": 0, "sources": []}

    from collections import Counter
    source_counts = Counter(meta['source'] for meta in results['metadatas'][0])
    majority_source = source_counts.most_common(1)[0][0]

    filtered_metas, filtered_texts = [], []
    for meta in results['metadatas'][0]:
        if meta['source'] == majority_source:
            filtered_metas.append(meta)
            filtered_texts.append(f"[Source : {meta['source']}]\n{meta['text']}")

    filtered_texts, filtered_metas = filtered_texts[:5], filtered_metas[:5]
    sources_txt = "\n\n---\n\n".join(filtered_texts)

    # ========== GÉNÉRATION ==========
    generation_prompt = f"""Tu es un assistant spécialisé en réglementation financière. Réponds UNIQUEMENT à partir des extraits ci-dessous. Cite tes sources.
Tu dois répondre en {"français" if question.lang == "fr" else "anglais"}.

RÈGLES :
1. Ne cite QUE des informations présentes dans les extraits.
2. Si l'information n'est pas présente, réponds simplement "Cette information n'est pas présente dans les documents fournis." sans citer de sources ni ajouter de commentaires.
3. Cite la source au plus UNE fois à la fin de chaque paragraphe ou point de liste.
4. Après chaque information, ajoute [Source : nom_du_fichier.pdf].

Extraits :
{sources_txt}

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

    # ========== VÉRIFICATION (arrière-plan) ==========
    import threading

    def run_verification():
        verification_prompt = f"""Ces extraits soutiennent-ils la réponse ? Réponds uniquement "OUI" ou "NON".
Extraits (résumé) : {sources_txt[:1000]}
Réponse : {generated_answer[:500]}
Vérificateur (OUI/NON) :"""
        try:
            if USE_AZURE and AZURE_MODEL_VERIF:
                verif = call_azure_llm(verification_prompt, AZURE_MODEL_VERIF)
            else:
                verif = ollama.generate(model=OLLAMA_MODEL, prompt=verification_prompt, options={"temperature": 0.0})['response'].strip()
            print(f"[VÉRIFICATION] {verif}")
        except Exception as e:
            print(f"[VÉRIFICATION] Erreur : {e}")

    threading.Thread(target=run_verification, daemon=True).start()

    # ========== SCORE DE CONFIANCE ==========
    best_distance = results['distances'][0][0] if results['distances'] else 1.5
    
    if best_distance < 0.3:
        confidence_score = 95 - int(best_distance * 50)
    elif best_distance < 0.6:
        confidence_score = 80 - int((best_distance - 0.3) * 100)
    elif best_distance < 1.0:
        confidence_score = 50 - int((best_distance - 0.6) * 62.5)
    elif best_distance <= 1.35:
        confidence_score = 25 - int((best_distance - 1.0) * 42)
    else:
        confidence_score = max(10, 25 - int((best_distance - 1.35) * 50))
    
    if confidence_score >= 70:
        confidence = "élevée"
    elif confidence_score >= 45:
        confidence = "moyenne"
    elif confidence_score >= 25:
        confidence = "faible"
    else:
        confidence = "très faible"

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
        chunks = chunk_text(text)
        for i, chunk in enumerate(chunks):
            chunk_id = f"{filename}_{i}"
            if USE_AZURE_EMBEDDING:
                embedding = get_azure_embedding(chunk)
            else:
                embedding = embedding_model.encode(chunk).tolist()
            collection.upsert(ids=[chunk_id], embeddings=[embedding], metadatas=[{"source": filename, "chunk_index": i, "text": chunk}])
    print("Indexation terminée.")
else:
    print("Aucun nouveau document à indexer.")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)