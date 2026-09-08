"""End-to-end test of the indexing pipeline: extraction cache, cross-document
batching, prefetch, and the move of chunk text out of the metadata.

Runs against real PDFs with a fake embedding model, so it checks the plumbing
(ids, ordering, page numbers, re-run behaviour) rather than model quality.

Run:  python test_indexing.py
"""
import os, sys, types, shutil, tempfile

os.environ.setdefault("AZURE_OPENAI_CHAT_DEPLOYMENT", "t")
os.environ.setdefault("AZURE_OPENAI_API_KEY", "t")
os.environ.setdefault("AZURE_OPENAI_ENDPOINT", "https://example.invalid")
os.environ["CACHE_DB_OVERRIDE"] = "1"

def _module(name, **attrs):
    m = types.ModuleType(name)
    for k, v in attrs.items(): setattr(m, k, v)
    sys.modules[name] = m
    return m

class _Tok:
    def encode(self, text, add_special_tokens=False):
        return list(range(max(1, len(text) // 4)))
    def __call__(self, texts, add_special_tokens=False):
        return {"input_ids": [list(range(max(1, len(t) // 4))) for t in texts]}

CALLS = {"encode": 0, "sizes": []}

class _ST:
    max_seq_length = 512
    def __init__(self, *a, **k): self.tokenizer = _Tok()
    def encode(self, text, **k):
        if isinstance(text, list):
            CALLS["encode"] += 1
            CALLS["sizes"].append(len(text))
            return [[float(len(t) % 7), 1.0, 0.0, 0.0] for t in text]
        return [0.0, 1.0, 0.0, 0.0]

class _CE:
    def __init__(self, *a, **k): pass
    def predict(self, pairs, **k): return [0.0] * len(pairs)

class _Coll:
    """A small but faithful stand-in for a Chroma collection."""
    def __init__(self): self.rows = {}
    def get(self, where=None, include=None, **k):
        items = [(i, r) for i, r in self.rows.items()
                 if not where or r["meta"].get("source") == where.get("source")]
        out = {"ids": [i for i, _ in items]}
        inc = include if include is not None else ["documents", "metadatas"]
        if "documents" in inc: out["documents"] = [r["doc"] for _, r in items]
        if "metadatas" in inc: out["metadatas"] = [r["meta"] for _, r in items]
        return out
    def delete(self, ids=None, **k):
        for i in ids or []: self.rows.pop(i, None)
    def upsert(self, ids, embeddings, documents, metadatas, **k):
        assert len(ids) == len(embeddings) == len(documents) == len(metadatas)
        for i, e, d, m in zip(ids, embeddings, documents, metadatas):
            self.rows[i] = {"emb": e, "doc": d, "meta": m}
    def count(self): return len(self.rows)
    def query(self, **k): return {}

COLL = _Coll()
_module("chromadb", PersistentClient=lambda *a, **k: types.SimpleNamespace(
    get_or_create_collection=lambda *a, **k: COLL,
    list_collections=lambda: [], delete_collection=lambda n: None))
class _App:
    def __init__(self, *a, **k): pass
    def add_middleware(self, *a, **k): pass
    def get(self, *a, **k): return lambda f: f
    def post(self, *a, **k): return lambda f: f
    def on_event(self, *a, **k): return lambda f: f
_module("fastapi", FastAPI=_App, HTTPException=Exception)
_module("fastapi.middleware")
_module("fastapi.middleware.cors", CORSMiddleware=object)
_module("openai", AzureOpenAI=lambda **k: types.SimpleNamespace())
_module("langdetect", DetectorFactory=types.SimpleNamespace(seed=0),
        detect=lambda t: "en")
_module("pydantic", BaseModel=object)
_module("sentence_transformers", SentenceTransformer=_ST, CrossEncoder=_CE)

import main

CHECKS = {"pass": 0, "fail": 0}
def check(label, condition, detail=""):
    if condition:
        CHECKS["pass"] += 1
    else:
        CHECKS["fail"] += 1
        print(f"  FAIL: {label} {detail}")

DOCS = "/mnt/user-data/uploads/chunk/rag-local/docs"
work = tempfile.mkdtemp()
main.DOCS_FOLDER = DOCS
main.EXTRACT_CACHE_DIR = os.path.join(work, "extract")
main.FINGERPRINT_FILE = os.path.join(work, "fp.json")

print("\n1. FIRST FULL INDEX")
n = main.load_and_index_documents(incremental=False)
check("chunks written", n > 100, f"got {n}")
check("every doc pooled into few encode calls",
      CALLS["encode"] <= 4, f"{CALLS['encode']} calls, sizes {CALLS['sizes']}")
check("batches are full, not per-document",
      max(CALLS["sizes"]) >= 256, f"largest {max(CALLS['sizes'])}")

print("2. STORED SHAPE")
sample = next(iter(COLL.rows.values()))
check("text stored as the document", len(sample["doc"]) > 0)
check("text NOT duplicated into metadata", "text" not in sample["meta"])
check("metadata keeps source/pages",
      {"source", "chunk_index", "page_start", "page_end"} <= set(sample["meta"]))

print("3. EMBEDDING/CHUNK ALIGNMENT")
# the fake model encodes len(text) % 7 into the vector, so a misaligned
# buffer flush would show up immediately
bad = [i for i, r in COLL.rows.items()
       if r["emb"][0] != float(len(f"passage: {r['doc']}") % 7)]
check("each vector belongs to its own chunk", not bad,
      f"{len(bad)} mismatched of {len(COLL.rows)}")

print("4. IDS AND PAGES")
ids_ok = all(i.rsplit("_", 1)[0] == r["meta"]["source"] for i, r in COLL.rows.items())
check("ids carry their source", ids_ok)
check("page numbers are sane",
      all(1 <= r["meta"]["page_start"] <= r["meta"]["page_end"]
          for r in COLL.rows.values()))

print("5. EXTRACTION CACHE")
cached_files = os.listdir(main.EXTRACT_CACHE_DIR)
check("extraction was cached", len(cached_files) >= 5, f"{len(cached_files)} files")
import time
CALLS["encode"] = 0
t = time.time(); main.load_and_index_documents(incremental=False); reread = time.time() - t
check("full reindex reuses cached text (no re-parse)", reread < 20,
      f"took {reread:.1f}s")

print("6. INCREMENTAL")
before = COLL.count()
CALLS["encode"] = 0
main.load_and_index_documents(incremental=True)
check("unchanged files are skipped entirely", CALLS["encode"] == 0,
      f"{CALLS['encode']} encode calls")
check("collection unchanged", COLL.count() == before)

print("7. NO ORPHANS ON RE-INDEX")
check("re-running does not duplicate chunks", COLL.count() == before,
      f"{COLL.count()} vs {before}")

print("8. AUTOMATIC INDEX RUNS (no command typed)")
import threading

# Two runs must never overlap: they would write the same ids and fight over the
# SQLite file. The second caller is turned away, not queued.
main._INDEX_LOCK.acquire()
turned_away = main.run_index(incremental=True, trigger="test-concurrent")
main._INDEX_LOCK.release()
check("a second run is refused while one is going", turned_away is None)

state = main.index_status()
check("status reports not-running when idle", state["running"] is False)

result = main.run_index(incremental=True, trigger="test")
check("a normal run still works after the lock is free", result is not None)
check("status records the trigger", main._INDEX_STATE["trigger"] == "test")
check("status records no error", main._INDEX_STATE["last_error"] is None)
check("status exposes the chunk count", main.index_status()["indexed_chunks"] > 0)

# A failing run must release the lock, or every later run is refused forever.
broken = main.load_and_index_documents
main.load_and_index_documents = lambda **k: (_ for _ in ()).throw(RuntimeError("boom"))
try:
    main.run_index(incremental=True, trigger="test-failure")
except RuntimeError:
    pass
main.load_and_index_documents = broken
check("the lock is released after a failure",
      main._INDEX_LOCK.acquire(blocking=False))
main._INDEX_LOCK.release()
check("the failure is recorded", main._INDEX_STATE["last_error"] == "boom")
check("running flag is cleared after a failure",
      main._INDEX_STATE["running"] is False)

background = main._index_in_background(incremental=True, trigger="test-bg")
background.join(timeout=120)
check("a background run completes", not background.is_alive())

print("9. STARTUP MUST NOT DISCARD A FINISHED INDEX")

# The trap: the collection name carries the embedding model, so starting with a
# different RAG_PROFILE opens an EMPTY collection. Auto-indexing on that would
# rebuild the whole corpus and abandon a finished index. Startup has to notice
# the populated sibling and refuse.
started = []
main._index_in_background = lambda incremental, trigger: started.append(trigger)


class _Sibling:
    def __init__(self, n): self.n = n
    def count(self): return self.n


def fake_client(others):
    return types.SimpleNamespace(
        list_collections=lambda: list(others),
        get_collection=lambda name: _Sibling(others[name]),
        get_or_create_collection=lambda *a, **k: COLL,
        delete_collection=lambda n: None)


real_client, real_count = main.chroma_client, COLL.count

# (a) our index empty, a sibling holds 24,280 chunks -> do NOT rebuild
COLL.count = lambda: 0
# A name that is NOT this profile's own collection - the small-model index.
SIBLING = "haca_docs__intfloat_multilingual_e5_small"
check("the sibling name differs from our own collection",
      SIBLING != main.COLLECTION_NAME)
main.chroma_client = fake_client({SIBLING: 24280})
main.on_startup()
check("a populated other-model index blocks the auto-rebuild", started == [],
      f"triggered {started}")

# (b) nothing indexed anywhere -> DO build
started.clear()
main.chroma_client = fake_client({})
main.on_startup()
check("a genuinely empty database does auto-build", started == ["startup"],
      f"triggered {started}")

# (c) our index already populated -> do nothing
started.clear()
COLL.count = real_count
main.chroma_client = fake_client({"haca_docs__other": 5})
main.on_startup()
check("a populated index is left alone", started == [], f"triggered {started}")

main.chroma_client = real_client



print("10. RATE-LIMIT HANDLING")

# A 429 must be retried with minute-scale backoff, honour Retry-After when the
# server sends one, and end as RateLimited (429 to the caller) rather than a
# generic 502 that reads like a broken pipeline.
class _Err(Exception):
    def __init__(self, message, retry_after=None):
        super().__init__(message)
        if retry_after is not None:
            self.response = types.SimpleNamespace(
                headers={"retry-after": str(retry_after)})

check("Retry-After is honoured",
      main._retry_after_seconds(_Err("429 rate limit", 12)) == 12.0,
      f"got {main._retry_after_seconds(_Err('429', 12))}")
check("Retry-After is capped at the maximum",
      main._retry_after_seconds(_Err("429", 99999)) == main.RATE_LIMIT_MAX_WAIT)
check("no header -> no suggested wait",
      main._retry_after_seconds(_Err("429 rate limit")) is None)

waits, calls = [], {"n": 0}
real_sleep, real_client = main.time.sleep, main.azure_client
main.time.sleep = lambda s: waits.append(s)

class _AlwaysThrottled:
    class chat:
        class completions:
            @staticmethod
            def create(**k):
                calls["n"] += 1
                raise _Err("Error code: 429 - {'code': 'rate_limit_exceeded', "
                           "'type': 'too_many_requests'}")

main.azure_client = _AlwaysThrottled()
try:
    main.generate_answer("q")
    check("a persistent 429 raises", False, "no exception")
except main.RateLimited as exc:
    check("a persistent 429 raises RateLimited", True)
    check("the message explains it is quota, not a bug",
          "quota is exhausted" in str(exc), str(exc)[:80])
except Exception as exc:
    check("a persistent 429 raises RateLimited", False, type(exc).__name__)

check("it retries the configured number of times",
      calls["n"] == main.RATE_LIMIT_ATTEMPTS,
      f"{calls['n']} calls vs {main.RATE_LIMIT_ATTEMPTS}")
check("backoff is minute-scale, not seconds",
      waits and min(waits) >= 15, f"waits {waits}")
check("it does not sleep after the final attempt",
      len(waits) == main.RATE_LIMIT_ATTEMPTS - 1, f"{len(waits)} sleeps")

# And a 429 that clears must succeed rather than being abandoned.
calls["n"] = 0

class _ThrottledOnce:
    class chat:
        class completions:
            @staticmethod
            def create(**k):
                calls["n"] += 1
                if calls["n"] == 1:
                    raise _Err("Error code: 429 - rate limit", 1)
                msg = types.SimpleNamespace(content="La circulaire impose...")
                return types.SimpleNamespace(
                    choices=[types.SimpleNamespace(message=msg)])

main.azure_client = _ThrottledOnce()
answer = main.generate_answer("q")
check("a transient 429 recovers", answer.startswith("La circulaire"), answer[:40])

main.time.sleep, main.azure_client = real_sleep, real_client

shutil.rmtree(work, ignore_errors=True)
print("\n" + "=" * 66)
print(f"{CHECKS['pass']} checks passed, {CHECKS['fail']} failed.")
print("=" * 66)
sys.exit(1 if CHECKS["fail"] else 0)
