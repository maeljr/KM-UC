
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
from azure.identity import DefaultAzureCredential
import requests
import base64

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
USE_AZURE = False

# --- CONFIGURATION AZURE AI SEARCH ---
AZURE_SEARCH_ENDPOINT = "https://srch-haca-shared-dev.search.windows.net"
AZURE_SEARCH_KEY = os.getenv("AZURE_SEARCH_KEY", "")
AZURE_SEARCH_INDEX = "haca-docs"
USE_AZURE_SEARCH = False  # Mettre à True pour utiliser Azure AI Search

# --- INITIALISATION ---
app = FastAPI(title="HACA Local RAG API")

# --- CORS ---
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
    """Découpe le texte par paragraphes, puis fusionne si nécessaire.
       C'est la méthode Paragraph Chunker, validée par les tests du 15/07/2026.
    """
    paragraphs = text.split('\n\n')
    chunks = []
    current_chunk = ""

    for para in paragraphs:
        para = para.strip()
        if not para:
            continue

        # Si le paragraphe seul est trop long, on le découpe par mots
        if len(para.split()) > max_chunk_size:
            if current_chunk:
                chunks.append(current_chunk.strip())
                current_chunk = ""
            words = para.split()
            for i in range(0, len(words), max_chunk_size - 50):
                chunk = " ".join(words[i : i + max_chunk_size])
                chunks.append(chunk)
            continue

        # Sinon, on essaie de l'ajouter au chunk courant
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


def load_and_index_documents():
    """Charge tous les PDFs du dossier docs, les découpe et les indexe dans ChromaDB."""
    if not os.path.exists(DOCS_FOLDER):
        print(f"Le dossier '{DOCS_FOLDER}' est introuvable. Aucun document indexé.")
        return

    for filename in os.listdir(DOCS_FOLDER):
        if filename.endswith(".pdf"):
            filepath = os.path.join(DOCS_FOLDER, filename)
            print(f"Traitement de : {filename}")

            text = extract_text_from_pdf(filepath)
            if not text.strip():
                print(f"  -> Aucun texte extrait, ignoré.")
                continue

            chunks = chunk_text(text)
            print(f"  -> {len(chunks)} chunks créés.")

            for i, chunk in enumerate(chunks):
                chunk_id = f"{filename}_{i}"
                embedding = embedding_model.encode(chunk).tolist()
                collection.upsert(
                    ids=[chunk_id],
                    embeddings=[embedding],
                    metadatas=[{"source": filename, "chunk_index": i, "text": chunk}]
                )
    print("Indexation terminée.")

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
            "algorithms": [
                {"name": "default-algorithm", "kind": "hnsw"}
            ],
            "profiles": [
                {"name": "default-profile", "algorithm": "default-algorithm"}
            ]
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
        "vectors": [
            {
                "value": query_embedding,
                "fields": "embedding",
                "k": n_results
            }
        ],
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

# --- API ENDPOINTS ---

@app.get("/")
def root():
    return {"message": "HACA Local RAG API is running. Use POST /ask to ask a question."}


@app.post("/reindex")
def reindex():
    """Vide la collection et réindexe tout le contenu du dossier docs."""
    existing = collection.get()
    if existing['ids']:
        collection.delete(ids=existing['ids'])
    load_and_index_documents()
    return {"status": "Réindexation terminée"}


class Question(BaseModel):
    query: str
    lang: str = "fr"

# --- CONFIGURATION AZURE (déjà dans main.py) ---
AZURE_ENDPOINT = "https://aif-haca-shared-dev.services.ai.azure.com"
AZURE_API_VERSION = "2025-01-01-preview"
AZURE_MODEL_GEN = "gpt-5.6-luna"
AZURE_MODEL_VERIF = None #"gpt-5.4-mini"
USE_AZURE = True

# --- CONFIGURATION AZURE AI SEARCH ---
AZURE_SEARCH_ENDPOINT = "https://srch-haca-shared-dev.search.windows.net"
AZURE_SEARCH_KEY = os.getenv("AZURE_SEARCH_KEY", "")
AZURE_SEARCH_INDEX = "haca-docs"
USE_AZURE_SEARCH = False

def call_azure_llm(prompt: str, model: str) -> str:
    """Appelle un modèle LLM sur Azure AI Foundry avec Device Code."""
    from azure.identity import DeviceCodeCredential
    import requests
    
    credential = DeviceCodeCredential(
        tenant_id="hacapartners.onmicrosoft.com",  # ou "hacapartners.lu"
        client_id="04b07795-8ddb-461a-bbee-02f9e1bf7b46"  # Azure CLI client ID
    )
    token = credential.get_token("https://cognitiveservices.azure.com/.default").token
    
    url = f"https://aif-haca-shared-dev.services.ai.azure.com/openai/deployments/{model}/chat/completions?api-version=2025-01-01-preview"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    body = {
        "messages": [{"role": "user", "content": prompt}],
        "max_completion_tokens": 2000
    }
    
    response = requests.post(url, headers=headers, json=body)
    
    if response.status_code != 200:
        raise Exception(f"Error code: {response.status_code} - {response.text}")
    
    return response.json()["choices"][0]["message"]["content"].strip()

# --- MÉTADONNÉES DES DOCUMENTS ---
DOCUMENTS_META = {
    "cssf22_822_annexe_240626.pdf": {
        "title": "Annexe Circulaire CSSF 22/822",
        "type": "Circulaire",
        "emetteur": "CSSF",
        "theme": "LCB-FT / GAFI",
        "date_publication": "19 juin 2026",
        "perimetre": "International"
    },
    "CSSF_CPDI_2651.pdf": {
        "title": "Circulaire CSSF-CPDI 26/51",
        "type": "Circulaire",
        "emetteur": "CSSF - CPDI",
        "theme": "Dépôts garantis (FGDL)",
        "date_publication": "1er juillet 2026",
        "perimetre": "Luxembourg"
    },
    "CSSF_CPDI_2650.pdf": {
        "title": "Circulaire CSSF-CPDI 26/50",
        "type": "Circulaire",
        "emetteur": "CSSF - CPDI",
        "theme": "Dépôts garantis (FGDL)",
        "date_publication": "26 mars 2026",
        "perimetre": "Luxembourg"
    },
    "cssf26_912.pdf": {
        "title": "Circulaire CSSF 26/912",
        "type": "Circulaire",
        "emetteur": "CSSF",
        "theme": "Abrogation IML 91/75",
        "date_publication": "22 mai 2026",
        "perimetre": "Luxembourg"
    }
}

@app.post("/ask")
def ask(question: Question):
    """Pose une question au système RAG avec double vérification asynchrone."""
    query = question.query
    query_embedding = embedding_model.encode(query).tolist()

    # --- OPTION A : Filtrage par métadonnées ---
    query_lower = query.lower()
    where_filter = None

    if any(kw in query_lower for kw in ["22/822", "gafi", "iran", "myanmar", "rpd", "corée", "blanchiment", "lbc", "ft", "contre-mesures", "liste grise", "haut risque"]):
        where_filter = {"source": "cssf22_822_annexe_240626.pdf"}
    elif any(kw in query_lower for kw in ["2650", "31 mars", "mars 2026", "16 mai", "trimestre mars"]):
        where_filter = {"source": "CSSF_CPDI_2650.pdf"}
    elif any(kw in query_lower for kw in ["2651", "30 juin", "juin 2026", "17 août", "août", "spécifications", "format", "20,2n", "exclus", "comptes exclus", "date limite"]):
        where_filter = {"source": "CSSF_CPDI_2651.pdf"}
    elif any(kw in query_lower for kw in ["26/912", "iml", "91/75", "abrogation"]):
        where_filter = {"source": "cssf26_912.pdf"}

    if USE_AZURE_SEARCH:
        azure_results = search_azure_index(query_embedding, n_results=8 if where_filter else 10)
        results = {
            "ids": [[r["id"] for r in azure_results]],
            "distances": [[1.0 - (r.get("@search.score", 0.5) or 0.5) for r in azure_results]],
            "metadatas": [[{"source": r["source"], "chunk_index": r["chunk_index"], "text": r["content"]} for r in azure_results]]
        }
    else:
        if where_filter:
            results = collection.query(query_embeddings=[query_embedding], n_results=5, where=where_filter)
        else:
            results = collection.query(query_embeddings=[query_embedding], n_results=10)

    # --- OPTION B : Seuil de distance ---
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

    # ========== ÉTAPE 1 : GÉNÉRATION ==========
    generation_prompt = f"""Tu es un assistant spécialisé en réglementation financière. Réponds UNIQUEMENT à partir des extraits ci-dessous. Cite tes sources.
Tu dois répondre en {"français" if question.lang == "fr" else "anglais"}.

RÈGLES :
1. Ne cite QUE des informations présentes dans les extraits.
2. Si l'information n'est pas présente, réponds simplement "Cette information n'est pas présente dans les documents fournis." sans citer de sources ni ajouter de commentaires.
3. Cite la source au plus UNE fois à la fin de chaque paragraphe ou point de liste. Ne répète pas la même citation au sein d'un même point.
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

    # ========== ÉTAPE 2 : VÉRIFICATION (arrière-plan, non bloquante) ==========
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
            import traceback
            print(f"[VÉRIFICATION] Erreur : {e}")
            traceback.print_exc()

    threading.Thread(target=run_verification, daemon=True).start()

        # Calculer le score de confiance (recalibré pour le modèle Azure)
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

    # Enrichir les sources avec le texte réel des chunks et les scores de distance
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


# --- DÉMARRAGE ---
if USE_AZURE_SEARCH:
    create_azure_search_index()
    print("Migration des documents vers Azure AI Search...")
    all_docs = collection.get()
    if all_docs['ids']:
        documents = []
        for i, doc_id in enumerate(all_docs['ids']):
            documents.append({
                "id": doc_id,
                "source": all_docs['metadatas'][i]['source'],
                "chunk_index": all_docs['metadatas'][i]['chunk_index'],
                "content": all_docs['metadatas'][i]['text'],
                "embedding": all_docs['embeddings'][i] if all_docs['embeddings'] else []
            })
        for i in range(0, len(documents), 100):
            batch = documents[i:i+100]
            index_documents_to_azure(batch)
        print("Migration terminée.")
else:
    load_and_index_documents()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)