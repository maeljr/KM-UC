# RAG — regulatory question answering

Projet 45, HACA Partners. Answers questions in French or English about the PDFs
in `docs\`, with a page citation for every answer.

Part of `C:\chunk` — see the README one folder up for the whole picture.

---

## Do I have to type commands?

No. Once set up, it looks after itself:

| | |
|---|---|
| Server | starts when you log in (`HACA-RAG-Server`) |
| Empty index | builds itself in the background at startup |
| New PDFs in `docs\` | picked up every 6 hours, in process |
| Nightly top-up | 05:30 (`HACA-RAG-Reindex`) |

The only command you type is the **first build**, once:

```powershell
cd C:\chunk\rag-local
.\rebuild_index_fast.ps1
```

That takes roughly half an hour because it reads ~330 PDFs and turns every
chunk into a vector. It is a one-time cost. After it, everything is incremental
and takes seconds.

---

## Everyday things

**Start it by hand**

```powershell
.\run.ps1
```

**Ask something**

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:8001/ask `
  -ContentType 'application/json' `
  -Body '{"question":"Quelles sont les obligations de la circulaire CSSF 24/856 ?"}'
```

**Add documents** — drop PDFs into `docs\`. Within 6 hours they are searchable.
To have them now:

```powershell
.\reindex_rag.ps1
```

**Is it busy?**

```powershell
Invoke-RestMethod http://127.0.0.1:8001/index/status
```

Tells you whether an index run is going, how long it has been going, and how the
last one ended. Indexing takes tens of minutes, so this beats guessing from a
log file.

**Why did it answer that?**

```powershell
Invoke-RestMethod "http://127.0.0.1:8001/debug/search?q=your+question"
```

Shows what was retrieved and how the reranker scored it — the fastest way to
tell a retrieval problem from a generation problem.

---

## How it answers

1. **Chunk** — PDFs are split by the embedding model's own tokenizer, ~380
   tokens with 80 overlapping. Chunking by *words* was the original bug: 800
   words against a 256-token model meant three quarters of every chunk was
   stored but never searchable.
2. **Search twice** — vectors for meaning, BM25 for exact strings. BM25 is what
   finds "Regulation (EU) 2017/565"; vectors reliably miss it.
3. **Fuse** — Reciprocal Rank Fusion, 40 candidates from each. A cosine distance
   and a BM25 score are not comparable, so only the rankings are combined.
4. **Rerank** — a cross-encoder reads each candidate *against* the question and
   keeps the best 5. This is where precision comes from.
5. **Answer** — Azure OpenAI, in the question's own language, told to say so
   when the excerpts do not cover it.

---

## Settings that matter

All environment variables. Defaults are in brackets.

| | |
|---|---|
| `RAG_PROFILE` [fast] | `fast` = e5-small, `quality` = e5-base (2.7× slower, slightly better recall) |
| `RAG_THREADS` [all cores] | embedding is thread-bound; torch is conservative on Windows |
| `RAG_OCR` [1] | `0` skips scanned pages — faster, but you lose them |
| `RAG_REINDEX_HOURS` [6] | in-process reindex interval; `0` turns it off |
| `RAG_AUTO_INDEX` [1] | build the index at startup if it is empty |
| `RAG_PRUNE_COLLECTIONS` [0] | `1` drops indexes left behind by old models |
| `AZURE_OPENAI_API_KEY` | set once with `setx`, never in a file |

### The profile trap

The collection is named after the embedding model. Start the server with a
different `RAG_PROFILE` than the index was built with and it opens an **empty**
collection rather than failing — so every question answers "not found in the
documents provided" and nothing looks broken.

`run.ps1` and `run_rag_server.ps1` both default to `fast`. Keep them in step
with whatever you built.

To switch properly:

```powershell
.\rebuild_index_fast.ps1 -Quality
```

Both indexes can coexist, so switching back is instant.

---

## Speed

Measured on these actual documents, not estimated.

- The embedding model is the whole cost. A 768-dimension encoder does ~2.6
  chunks/second on two threads; the corpus is ~12,000 chunks. That is 78
  minutes. `fast` is 2.7× quicker.
- PyMuPDF reads PDFs 11× faster than pypdf (26.9 s → 2.4 s on 623 pages).
  Install it: `python -m pip install pymupdf`.
- `.extract_cache\` stores the extracted text keyed by file fingerprint, so PDF
  parsing and OCR are paid **once, ever** — including across a model change.
  Delete the folder to force a clean re-read.
- One document, `ISA-540-Revised-and-Conforming-Amendments_0.pdf` (42 MB), is a
  pure scan: all 95 pages are images. With `RAG_OCR=0` it contributes nothing.

---

## Tests

```powershell
python test_rag_logic.py       # 49 checks - retrieval logic, offline
python test_indexing.py        # 14 checks - the indexing pipeline
```

`test_indexing.py` runs the real pipeline over real PDFs with a fake embedding
model, checking that vectors stay aligned with their chunks across buffer
flushes, that the extraction cache works, that incremental skips unchanged
files, that re-running leaves no duplicates or orphans, and that a failed run
releases its lock instead of blocking every later run.

---

## If something is wrong

**Every answer is "not found in the documents provided"** — profile mismatch,
see above. Check `GET /` and compare `embedding_model` with what you built.

**`WinError 10048`, port 8001 in use** — a server is already running. A running
process holds its old code in memory, so this is also why an edit to `main.py`
seems to do nothing. `rebuild_index_fast.ps1` stops the old one first.

**Indexing looks hung** — it probably is not. Check `GET /index/status` and the
per-file progress with its ETA in the log.

**`chroma.sqlite3` is enormous** — indexes from old embedding models are still
in it. Start once with `RAG_PRUNE_COLLECTIONS=1`.

**A PDF produces no chunks** — it is a scan with `RAG_OCR=0`, or it has no text
layer at all. `GET /debug/source?filename=...` shows what was stored.
