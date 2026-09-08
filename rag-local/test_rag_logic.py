"""Offline tests for the retrieval logic in main.py.

The heavy dependencies (chromadb, sentence-transformers, openai, fastapi) are
stubbed, so this exercises the parts that are pure Python and therefore the
parts most likely to contain a real bug: lexical tokenisation, rank fusion,
token-aware chunking, page labels, language detection and the cache.

Run:  python test_rag_logic.py
"""

import os
import sys
import types

os.environ.setdefault("AZURE_OPENAI_CHAT_DEPLOYMENT", "test-deployment")
os.environ.setdefault("AZURE_OPENAI_API_KEY", "test-key")
os.environ.setdefault("AZURE_OPENAI_ENDPOINT", "https://example.invalid")
os.environ["CACHE_DB_OVERRIDE"] = "1"


# ---------------------------------------------------------------- stubs ----
def _module(name, **attrs):
    mod = types.ModuleType(name)
    for key, value in attrs.items():
        setattr(mod, key, value)
    sys.modules[name] = mod
    return mod


class _FakeTokenizer:
    """Roughly one token per four characters, like a real subword tokenizer."""
    def encode(self, text, add_special_tokens=False):
        return list(range(max(1, len(text) // 4)))


class _FakeSentenceTransformer:
    max_seq_length = 512

    def __init__(self, *_a, **_k):
        self.tokenizer = _FakeTokenizer()

    def encode(self, text, **_k):
        if isinstance(text, list):
            return [[0.0] * 8 for _ in text]
        return [0.0] * 8


class _FakeCrossEncoder:
    def __init__(self, *_a, **_k):
        pass

    def predict(self, pairs, **_k):
        # crude lexical overlap, enough to give a deterministic ordering
        out = []
        for question, passage in pairs:
            q = set(question.lower().split())
            p = set(passage.lower().split())
            out.append(len(q & p) / max(1, len(q)) * 10 - 2)
        return out


class _FakeCollection:
    def __init__(self):
        self.rows = {}

    def count(self):
        return len(self.rows)

    def upsert(self, ids, embeddings, documents, metadatas):
        for i, _id in enumerate(ids):
            self.rows[_id] = metadatas[i]

    def get(self, where=None, include=None):
        ids, metas = [], []
        for _id, meta in self.rows.items():
            if where and meta.get("source") != where.get("source"):
                continue
            ids.append(_id)
            metas.append(meta)
        return {"ids": ids, "metadatas": metas}

    def query(self, query_embeddings, n_results):
        ids = list(self.rows)[:n_results]
        return {
            "ids": [ids],
            "metadatas": [[self.rows[i] for i in ids]],
            "distances": [[0.1 * n for n in range(len(ids))]],
        }


class _FakeChromaClient:
    def __init__(self, *_a, **_k):
        self.collections = {}

    def get_or_create_collection(self, name, metadata=None):
        return self.collections.setdefault(name, _FakeCollection())

    def delete_collection(self, name):
        self.collections.pop(name, None)


_module("chromadb", PersistentClient=_FakeChromaClient)
_module("sentence_transformers",
        SentenceTransformer=_FakeSentenceTransformer,
        CrossEncoder=_FakeCrossEncoder)
_module("openai", AzureOpenAI=lambda **_k: types.SimpleNamespace())
_module("pdf2image", convert_from_path=lambda *_a, **_k: [])
_module("pytesseract", image_to_string=lambda *_a, **_k: "")
_module("langdetect",
        detect=lambda t: "fr" if " le " in f" {t.lower()} " else "en",
        DetectorFactory=types.SimpleNamespace(seed=0))


class _App:
    def __init__(self, **_k):
        pass

    def add_middleware(self, *_a, **_k):
        pass

    def _decorator(self, *_a, **_k):
        return lambda fn: fn

    get = post = on_event = _decorator


_module("fastapi", FastAPI=_App,
        HTTPException=type("HTTPException", (Exception,), {}))
_module("fastapi.middleware", )
_module("fastapi.middleware.cors", CORSMiddleware=object)

import main as rag  # noqa: E402

FAILURES, CHECKS = [], [0]


def check(condition, label):
    CHECKS[0] += 1
    if not condition:
        FAILURES.append(label)
        print(f"  FAIL  {label}")


def eq(actual, expected, label):
    check(actual == expected, f"{label} (got {actual!r}, want {expected!r})")


# ============================================================ lexical ======
print("\n1. LEXICAL TOKENISATION (the fix for exact identifiers)")

tokens = rag.lexical_tokens("Delegated Regulation (EU) 2017/565 on MiFID II")
check("2017/565" in tokens, "the full identifier '2017/565' is kept as one token")
check("2017" in tokens and "565" in tokens,
      "and is ALSO split, so a question writing it either way still matches")
check("delegated" in tokens and "regulation" in tokens, "words are lowercased")

tokens = rag.lexical_tokens("Le réviseur d'entreprises doit vérifier")
check("reviseur" in tokens,
      "accents are folded, so 'reviseur' finds 'réviseur' (got %r)" % tokens)
check("entreprises" in tokens, "apostrophes split words")

tokens = rag.lexical_tokens("Circular CSSF 26/906 and RTS 27")
check("26/906" in tokens, "CSSF circular numbers survive tokenisation")
check("27" in tokens, "'RTS 27' keeps its number")

eq(rag.lexical_tokens(""), [], "empty text gives no tokens")
eq(rag.lexical_tokens(None), [], "None gives no tokens")

# ============================================================ fusion =======
print("\n2. RECIPROCAL RANK FUSION")


def cand(cid, source="d.pdf", text="x", distance=None, bm25=None):
    return {"id": cid, "source": source, "chunk_index": 0, "page_start": 1,
            "page_end": 1, "text": text, "distance": distance, "bm25": bm25}


dense = [cand("a", distance=0.1), cand("b", distance=0.2), cand("c", distance=0.3)]
lexical = [cand("c", bm25=9.0), cand("d", bm25=4.0)]
fused = rag.fuse(dense, lexical)
ids = [c["id"] for c in fused]

eq(len(fused), 4, "fusion de-duplicates across the two rankings")
eq(ids[0], "c", "a chunk ranked by BOTH searches wins, even at rank 3 in dense")
check(set(ids) == {"a", "b", "c", "d"}, "nothing is lost in fusion")
merged = next(c for c in fused if c["id"] == "c")
check(merged["distance"] == 0.3 and merged["bm25"] == 9.0,
      "the merged candidate keeps both signals")

# A lexical-only hit must be able to reach the pool. This is the whole point:
# it is how "Regulation (EU) 2017/565" gets in when the vectors miss it.
lexical_only = rag.fuse([], [cand("z", bm25=12.0)])
eq([c["id"] for c in lexical_only], ["z"],
   "a purely lexical hit still reaches the reranker")
eq(rag.fuse([], []), [], "two empty rankings fuse to nothing")

# Order within a single ranking must be preserved when the other is empty.
only_dense = rag.fuse([cand("1"), cand("2"), cand("3")], [])
eq([c["id"] for c in only_dense], ["1", "2", "3"],
   "dense order is preserved when there is no lexical ranking")

# ============================================================ chunking =====
print("\n3. TOKEN-AWARE CHUNKING (the fix for silent truncation)")

sentence = "This is a sentence about regulatory capital requirements. "
pages = [(1, sentence * 40), (2, sentence * 40)]
chunks = rag.chunk_pages(pages, target_tokens=100, overlap_tokens=20)

check(len(chunks) > 1, f"a long document produces several chunks (got {len(chunks)})")
oversize = [c for c in chunks if rag._token_count(c["text"]) > 100 * 1.35]
eq(oversize, [], "no chunk materially exceeds the token target")
check(all(c["page_start"] >= 1 for c in chunks), "every chunk records a page")
check(any(c["page_start"] == 2 or c["page_end"] == 2 for c in chunks),
      "page 2 content is represented")

# The regression that mattered: an 800-word chunk against a 256-token model.
long_page = [(1, "word " * 800)]
chunks = rag.chunk_pages(long_page, target_tokens=380, overlap_tokens=80)
biggest = max(rag._token_count(c["text"]) for c in chunks)
check(biggest <= 380 * 1.35,
      f"800 words is split to fit the window, not truncated (biggest {biggest} tokens)")

# Overlap should genuinely repeat content across a boundary.
pages = [(1, " ".join(f"sentence{i} about capital." for i in range(60)))]
chunks = rag.chunk_pages(pages, target_tokens=80, overlap_tokens=30)
if len(chunks) > 1:
    first_words = set(chunks[0]["text"].split())
    second_words = set(chunks[1]["text"].split())
    check(first_words & second_words,
          "consecutive chunks overlap, so a fact on a boundary is intact somewhere")

# A single enormous "sentence" (a table, or an OCR run-on) must not defeat it.
chunks = rag.chunk_pages([(1, "x" * 12000)], target_tokens=100, overlap_tokens=20)
check(len(chunks) >= 1, "an unsplittable blob still yields chunks")
check(max(rag._token_count(c["text"]) for c in chunks) < 100 * 3,
      "and none of them is wildly oversized")

eq(rag.chunk_pages([], 100, 20), [], "no pages gives no chunks")
eq(rag.chunk_pages([(1, "   ")], 100, 20), [], "a blank page gives no chunks")

# ============================================================ pages ========
print("\n4. PAGE LABELS IN CITATIONS")

eq(rag._page_label({"page_start": 12, "page_end": 12, "chunk_index": 3}),
   "[p.12]", "a single-page chunk cites one page")
eq(rag._page_label({"page_start": 12, "page_end": 14, "chunk_index": 3}),
   "[p.12-14]", "a spanning chunk cites a range")
eq(rag._page_label({"page_start": None, "page_end": None, "chunk_index": 7}),
   "[chunk 7]", "an old chunk with no page falls back to its index")

# ============================================================ language =====
print("\n5. LANGUAGE DETECTION")

for text, expected in [
    ("Quels sont les impacts de la nouvelle norme IFRS 18 ?", "fr"),
    ("Quelles sont les exigences de la circulaire CSSF 26/906 ?", "fr"),
    ("Quelles sont les travaux que le réviseur d'entreprises doit effectuer", "fr"),
    ("What are the ECB's supervisory priorities?", "en"),
    ("climate change monetary policy", "en"),
    ("", "en"),
]:
    eq(rag.detect_language(text), expected, f"language of {text[:44]!r}")

check("trouvé" in rag.not_found_message("fr"), "the French fallback is French")
check("could not find" in rag.not_found_message("en"), "the English fallback is English")

# ============================================================ cache ========
print("\n6. ANSWER CACHE")

rag.CACHE_DB = "./_test_cache.sqlite"
if os.path.exists(rag.CACHE_DB):
    os.remove(rag.CACHE_DB)

good = {"answer": "Yes.", "sources": [{"source": "a.pdf"}], "confidence": 5.0}
empty = {"answer": rag.not_found_message("en"), "sources": [], "confidence": -2.0}

rag.store_answer("a question", "en", good)
check(rag.get_cached_answer("a question", "en") is not None, "a good answer is cached")

rag.store_answer("a failing question", "en", empty)
check(rag.get_cached_answer("a failing question", "en") is None,
      "a NOT-FOUND answer is NOT cached — otherwise a fixed pipeline keeps "
      "serving the old failure")

check(rag.get_cached_answer("A QUESTION", "en") is not None,
      "cache lookup is case- and whitespace-insensitive")
check(rag.get_cached_answer("a question", "fr") is None,
      "the cache key includes the language, so FR and EN do not collide")

rag.clear_cache()
check(rag.get_cached_answer("a question", "en") is None, "clear_cache empties it")

# Deleting the file only works if every connection was closed. On Windows a
# leaked handle makes this raise PermissionError -- which is how the leak was
# found in the first place, so the check stays.
try:
    os.remove(rag.CACHE_DB)
    check(True, "the cache file can be deleted (no leaked SQLite connections)")
except PermissionError:
    check(False, "a SQLite connection is still open — the cache file is locked")
except FileNotFoundError:
    check(True, "cache file already gone")

# ============================================================ config =======
print("\n7. CONFIGURATION SANITY")

check(rag.CHUNK_TARGET_TOKENS < rag.EMBED_MAX_TOKENS,
      f"chunk target ({rag.CHUNK_TARGET_TOKENS}) fits the embedding window "
      f"({rag.EMBED_MAX_TOKENS}) — the bug that made 75% of each chunk "
      f"unsearchable")
check(rag.RETRIEVAL_CANDIDATES >= 20,
      f"the candidate pool is large enough to rerank meaningfully "
      f"(got {rag.RETRIEVAL_CANDIDATES})")
check(rag.RERANK_TOP_K <= rag.RETRIEVAL_CANDIDATES,
      "top-k cannot exceed the pool")
check("*" not in rag.CORS_ORIGINS,
      "CORS is not a wildcard alongside allow_credentials")
check(rag.COLLECTION_NAME.endswith(
      rag.re.sub(r'[^a-z0-9]+', '_', rag.EMBEDDING_MODEL.lower()).strip('_')[-40:]),
      "the collection name is tied to the embedding model, so two models "
      "cannot share an index")
check(not hasattr(rag, "DISTANCE_THRESHOLD"),
      "the dead DISTANCE_THRESHOLD config is gone")

print("\n" + "=" * 66)
if FAILURES:
    print(f"{len(FAILURES)} FAILED of {CHECKS[0]}")
    for failure in FAILURES:
        print(f"  - {failure}")
    sys.exit(1)
print(f"All {CHECKS[0]} checks passed.")
print("=" * 66)
