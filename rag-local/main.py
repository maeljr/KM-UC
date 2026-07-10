import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import chromadb
from sentence_transformers import SentenceTransformer
from pypdf import PdfReader
import ollama

# --- CONFIGURATION ---
MODEL_NAME = 'all-MiniLM-L6-v2'
CHROMA_DB_PATH = "./chroma_db"
COLLECTION_NAME = "haca_docs"
OLLAMA_MODEL = "llama3.2:3b"
# OLLAMA_MODEL = "mistral:7b"
DOCS_FOLDER = "./docs"

# --- INITIALISATION ---
app = FastAPI(title="HACA Local RAG API")

# --- CORS (doit être AVANT les routes) ---
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

def chunk_text(text, chunk_size=500, overlap=50):
    """Découpe un texte en morceaux avec chevauchement."""
    words = text.split()
    chunks = []
    for i in range(0, len(words), chunk_size - overlap):
        chunk = " ".join(words[i : i + chunk_size])
        chunks.append(chunk)
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

@app.post("/ask")
def ask(question: Question):
    """Pose une question au système RAG."""
    query = question.query
    query_embedding = embedding_model.encode(query).tolist()
    
    # --- OPTION A : Filtrage par métadonnées strict (enrichi) ---
    query_lower = query.lower()
    where_filter = None
    
    if any(kw in query_lower for kw in ["22/822", "gafi", "iran", "myanmar", "rpd", "corée", "blanchiment", "lbc", "ft", "contre-mesures", "liste grise", "haut risque"]):
        where_filter = {"source": "cssf22_822_annexe_240626.pdf"}
    elif any(kw in query_lower for kw in ["2650", "31 mars", "mars 2026", "16 mai"]):
        where_filter = {"source": "CSSF_CPDI_2650.pdf"}
    elif any(kw in query_lower for kw in ["2651", "30 juin", "juin 2026", "17 août", "spécifications", "format", "20,2n", "exclus", "comptes exclus"]):
        where_filter = {"source": "CSSF_CPDI_2651.pdf"}
    elif any(kw in query_lower for kw in ["26/912", "iml", "91/75", "abrogation"]):
        where_filter = {"source": "cssf26_912.pdf"}
    
    if where_filter:
        results = collection.query(
            query_embeddings=[query_embedding],
            n_results=5,
            where=where_filter
        )
    else:
        results = collection.query(
            query_embeddings=[query_embedding],
            n_results=10
        )
    # --- FIN OPTION A ---
    
    # --- OPTION B : Seuil de distance ---
    if results['distances'] and results['distances'][0]:
        best_distance = results['distances'][0][0]
        if best_distance > 1.2:
            return {
                "answer": "Je n'ai trouvé aucun document pertinent pour répondre à cette question.",
                "sources": []
            }
    # --- FIN OPTION B ---
    
    if not results['ids'][0]:
        return {"answer": "Je n'ai trouvé aucun document pertinent pour répondre à cette question.", "sources": []}

    # Regrouper par source majoritaire
    from collections import Counter
    source_counts = Counter(meta['source'] for meta in results['metadatas'][0])
    majority_source = source_counts.most_common(1)[0][0]
    
    filtered_metas = []
    filtered_texts = []
    for i, meta in enumerate(results['metadatas'][0]):
        if meta['source'] == majority_source:
            filtered_metas.append(meta)
            filtered_texts.append(f"[Source : {meta['source']}]\n{meta['text']}")
    
    filtered_texts = filtered_texts[:5]
    filtered_metas = filtered_metas[:5]
    sources_txt = "\n\n---\n\n".join(filtered_texts)
    
    prompt = f"""Tu es un assistant spécialisé en réglementation financière luxembourgeoise et européenne.
Réponds à la question en te basant UNIQUEMENT sur les extraits fournis ci-dessous.
Utilise le contexte général et les synonymes réglementaires évidents.

RÈGLES IMPÉRATIVES :
1. Ne cite QUE des informations présentes textuellement dans les extraits.
2. Si une information n'est pas dans les extraits, réponds : "Cette information n'est pas présente dans les documents fournis."
3. N'invente JAMAIS une définition, une date, un nom d'institution ou un chiffre.
4. Pour les formats techniques (ex: '20,2N'), ne les interprète que si la légende explicative est présente dans les extraits. Sinon, indique que la définition n'est pas fournie.
5. Sois direct et factuel : réponds à la question sans préambule ni excuse.

Extraits (tous issus du même document) :
{sources_txt}

Question : {query}
Réponse :"""

    try:
        response = ollama.generate(
            model=OLLAMA_MODEL,
            prompt=prompt,
            options={"temperature": 0.0}
        )
        answer = response['response'].strip()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur lors de l'appel à Ollama : {str(e)}")

    return {
        "answer": answer,
        "sources": [{"source": meta['source'], "chunk_index": meta['chunk_index']} for meta in filtered_metas]
    }

# --- DÉMARRAGE ---
load_and_index_documents()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)