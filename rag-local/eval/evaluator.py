import json
import sys
import os
import datetime

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sentence_transformers import SentenceTransformer
import chromadb
from pypdf import PdfReader

from chunking.baselines import chunk_text as baseline_chunk
from chunking.paragraph_chunker import chunk_text as paragraph_chunk
from chunking.recursive_chunker import chunk_text as recursive_chunk
from chunking.token_chunker import chunk_text as token_chunk

# --- CONFIGURATION ---
MODEL_NAME = 'all-MiniLM-L6-v2'
CHROMA_DB_PATH = "./chroma_db_test"
COLLECTION_NAME = "test_collection"
DOCS_FOLDER = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "docs")
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

with open(os.path.join(SCRIPT_DIR, "test_questions.json"), "r", encoding="utf-8") as f:
    test_questions = json.load(f)

print("Chargement du modèle d'embedding...")
embedding_model = SentenceTransformer(MODEL_NAME)


def extract_text_from_pdf(pdf_path):
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


def index_documents(chunk_function, chunker_name):
    print(f"\n=== Indexation avec {chunker_name} ===")
    chroma_client = chromadb.PersistentClient(path=CHROMA_DB_PATH)
    try:
        chroma_client.delete_collection(name=COLLECTION_NAME)
    except:
        pass
    collection = chroma_client.create_collection(name=COLLECTION_NAME)

    for filename in os.listdir(DOCS_FOLDER):
        if filename.endswith(".pdf"):
            filepath = os.path.join(DOCS_FOLDER, filename)
            print(f"  Traitement de : {filename}")
            text = extract_text_from_pdf(filepath)
            if not text.strip():
                print(f"    -> Aucun texte extrait, ignoré.")
                continue
            chunks = chunk_function(text)
            print(f"    -> {len(chunks)} chunks créés.")
            for i, chunk in enumerate(chunks):
                chunk_id = f"{filename}_{i}"
                embedding = embedding_model.encode(chunk).tolist()
                collection.add(
                    ids=[chunk_id],
                    embeddings=[embedding],
                    metadatas=[{"source": filename, "chunk_index": i, "text": chunk}]
                )
    return collection


def compute_keyword_score(top_chunks, keywords):
    if not keywords:
        return None
    all_text = " ".join(top_chunks).lower()
    found = sum(1 for kw in keywords if kw.lower() in all_text)
    return round(found / len(keywords) * 100, 1)


def compute_precision_at_1(top_chunks, keywords):
    if not keywords or not top_chunks:
        return None
    first_chunk = top_chunks[0].lower()
    return any(kw.lower() in first_chunk for kw in keywords)


def compute_precision_at_5(top_chunks, keywords):
    if not keywords or not top_chunks:
        return None
    all_text = " ".join(top_chunks).lower()
    return all(kw.lower() in all_text for kw in keywords)


def evaluate(collection, chunker_name):
    results = []
    scores = []
    precision_1 = []
    precision_5 = []

    for q in test_questions:
        query_embedding = embedding_model.encode(q['query']).tolist()
        res = collection.query(query_embeddings=[query_embedding], n_results=5)
        top_texts = [meta['text'] for meta in res['metadatas'][0]]
        top_sources = [meta['source'] for meta in res['metadatas'][0]]

        kw_score = compute_keyword_score(top_texts, q.get('keywords', []))
        p1 = compute_precision_at_1(top_texts, q.get('keywords', []))
        p5 = compute_precision_at_5(top_texts, q.get('keywords', []))

        if kw_score is not None:
            scores.append(kw_score)
        if p1 is not None:
            precision_1.append(1 if p1 else 0)
        if p5 is not None:
            precision_5.append(1 if p5 else 0)

        results.append({
            "query": q['query'],
            "expected": q['expected'],
            "expect_answer": q.get('expect_answer', True),
            "keyword_score": kw_score,
            "precision_at_1": p1,
            "precision_at_5": p5,
            "top_sources": top_sources,
            "top_chunks": top_texts
        })

    avg_score = round(sum(scores) / len(scores), 1) if scores else 0
    avg_p1 = round(sum(precision_1) / len(precision_1) * 100, 1) if precision_1 else 0
    avg_p5 = round(sum(precision_5) / len(precision_5) * 100, 1) if precision_5 else 0

    summary = {
        "chunker": chunker_name,
        "average_keyword_score": avg_score,
        "precision_at_1": avg_p1,
        "precision_at_5": avg_p5,
        "total_questions": len(test_questions),
        "questions_with_keywords": len(scores)
    }

    return results, summary


def print_summary(summary):
    print(f"\n{'='*60}")
    print(f"RÉSULTATS : {summary['chunker']}")
    print(f"{'='*60}")
    print(f"Score moyen de couverture des mots-clés : {summary['average_keyword_score']} %")
    print(f"Precision@1 (1er chunk contient ≥1 mot-clé) : {summary['precision_at_1']} %")
    print(f"Precision@5 (tous les mots-clés trouvés)    : {summary['precision_at_5']} %")
    print(f"Questions évaluées avec mots-clés          : {summary['questions_with_keywords']}/{summary['total_questions']}")


if __name__ == "__main__":
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    results_dir = os.path.join(SCRIPT_DIR, "runs", timestamp)
    os.makedirs(results_dir, exist_ok=True)
    print(f"Dossier de résultats : {results_dir}")

    chunkers = [
        (baseline_chunk, "Baseline (mots)"),
        (paragraph_chunk, "Paragraph Chunker"),
        (recursive_chunk, "Recursive (LangChain)"),
        (token_chunk, "Token-based (512 tokens)"),
    ]

    global_summaries = {}

    for chunk_func, chunk_name in chunkers:
        coll = index_documents(chunk_func, chunk_name)
        results, summary = evaluate(coll, chunk_name)
        print_summary(summary)
        
        filename = f"{chunk_name.lower().replace(' ', '_').replace('(', '').replace(')', '')}_results.json"
        with open(os.path.join(results_dir, filename), "w", encoding="utf-8") as f:
            json.dump(results, f, indent=2, ensure_ascii=False)
        
        summary_filename = f"{chunk_name.lower().replace(' ', '_').replace('(', '').replace(')', '')}_summary.json"
        with open(os.path.join(results_dir, summary_filename), "w", encoding="utf-8") as f:
            json.dump(summary, f, indent=2, ensure_ascii=False)
        
        global_summaries[chunk_name] = summary

    global_summary = {
        "timestamp": timestamp,
        "summaries": global_summaries
    }
    with open(os.path.join(results_dir, "global_summary.json"), "w", encoding="utf-8") as f:
        json.dump(global_summary, f, indent=2, ensure_ascii=False)

    print(f"\n{'='*60}")
    print(f"Tests terminés. Résultats sauvegardés dans : {results_dir}")
    print(f"{'='*60}")