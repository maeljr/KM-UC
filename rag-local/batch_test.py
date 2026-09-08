"""
Batch test runner for the HACA RAG API.

    python batch_test.py                     questions.txt -> results.csv
    python batch_test.py mine.txt out.csv    custom files
    python batch_test.py --force-refresh     ignore the answer cache
    python batch_test.py --resume            skip questions already in out.csv
    python batch_test.py --compare old.csv   diff against a previous run

Written to be usable against a RATE-LIMITED deployment, which is the situation
that actually matters here. Three things it does that the previous version did
not, each because of a way the last run wasted time:

  1. IT CHECKS THE SERVER FIRST. 120 questions each failing with "connection
     refused" is four minutes spent learning one fact. It now stops on the first
     question with a message saying how to start the server.

  2. IT SURVIVES A 429. Azure limits this deployment per minute, so a long run
     WILL be throttled part-way. Recording "[HTTP 429]" as the answer makes the
     whole run worthless -- so a throttled question waits and retries, and only
     gives up after several attempts.

  3. IT CAN RESUME. --resume reads the existing CSV and skips what already has a
     real answer, so an interrupted run costs only what is left.
"""

import csv
import os
import sys
import time

import requests

API_BASE = os.environ.get("RAG_API_BASE", "http://127.0.0.1:8001")
API_URL = f"{API_BASE}/ask"
DEFAULT_QUESTIONS_FILE = "questions.txt"
DEFAULT_OUTPUT_FILE = "results.csv"

TIMEOUT_SECONDS = 600          # a cold reranker plus generation on CPU
RATE_LIMIT_ATTEMPTS = 4
RATE_LIMIT_WAITS = (20, 45, 75)
PAUSE_BETWEEN = float(os.environ.get("RAG_BATCH_PAUSE", "2"))

FIELDNAMES = ["#", "question", "answer", "sources", "confidence", "from_cache",
              "language", "elapsed_seconds", "status"]


def load_questions(path):
    """Read questions.txt, one question per line.

    Every line is sent to the RAG verbatim, so a typo in this file is measured
    as if it were the model's fault. 65 of the 120 lines once carried a trailing
    category label and a stray quote -- 'FATF virtual assets" Virtual assets and
    VASPs' -- and the batch scored the garbled string. Blank lines and lines
    starting with # are skipped; a stray quote is stripped and reported rather
    than silently sent.
    """
    if not os.path.exists(path):
        sys.exit(f"Question file not found: {path}")

    questions, repaired = [], []
    with open(path, "r", encoding="utf-8-sig") as handle:
        for number, line in enumerate(handle, start=1):
            text = line.strip()
            if not text or text.startswith("#"):
                continue
            cleaned = text
            if cleaned.startswith('"') and cleaned.endswith('"') and cleaned.count('"') == 2:
                cleaned = cleaned[1:-1].strip()
            if cleaned.count('"') % 2:
                cleaned = cleaned.replace('"', "").strip()
            # Normalising whitespace is not a repair worth reporting: French
            # lines legitimately carry a non-breaking space before '?'.
            quotes_changed = cleaned != text
            cleaned = " ".join(cleaned.split())
            if quotes_changed:
                repaired.append((number, text, cleaned))
            if cleaned:
                questions.append(cleaned)

    if repaired:
        print(f"WARNING: repaired {len(repaired)} malformed line(s) in {path}:")
        for number, before, after in repaired[:10]:
            print(f"  line {number}: {before[:70]}")
            print(f"        -> {after[:70]}")
        if len(repaired) > 10:
            print(f"  ... and {len(repaired) - 10} more")
        print("  Fix the file -- these are being measured as questions.")

    duplicates = len(questions) - len(set(questions))
    if duplicates:
        print(f"Note: {duplicates} duplicate question(s); kept, they check answer consistency.")

    return questions


def preflight():
    """Refuse to start against a server that is not there or not ready.

    Every failure mode below produces 120 identical errors if ignored, so each
    one is worth naming precisely instead of once per question.
    """
    try:
        info = requests.get(f"{API_BASE}/", timeout=10).json()
    except requests.exceptions.RequestException:
        sys.exit(
            f"No RAG server is answering on {API_BASE}.\n"
            f"  Start it:  Start-ScheduledTask -TaskName HACA-RAG-Server\n"
            f"  or:        python main.py\n"
            f"It takes about 90 seconds to load the models.")

    chunks = int(info.get("indexed_chunks") or 0)
    print(f"Server   : {info.get('pipeline_version')}")
    print(f"Model    : {info.get('embedding_model')}  (profile "
          f"{info.get('profile')})")
    print(f"Index    : {chunks} chunks, hybrid "
          f"{'ON' if info.get('hybrid_search') else 'OFF'}")
    print(f"Answers  : {info.get('answers_enabled')}  "
          f"(auth: {info.get('auth_mode')})")

    if chunks == 0:
        sys.exit("\nThe index is EMPTY, so every answer would be 'not found'.\n"
                 "Check the profile matches the index that was built.")
    if not info.get("answers_enabled"):
        sys.exit(f"\nAnswers are disabled: {info.get('auth_problem')}\n"
                 f"Retrieval works, but this test needs generation.")
    return info


def ask(question, force_refresh):
    """One question, retrying through a rate limit rather than recording it."""
    payload = {"query": question, "force_refresh": force_refresh}
    started = time.time()

    for attempt in range(RATE_LIMIT_ATTEMPTS):
        try:
            resp = requests.post(API_URL, json=payload, timeout=TIMEOUT_SECONDS)
        except requests.exceptions.RequestException as exc:
            return {"answer": f"[REQUEST ERROR] {exc}", "sources": "",
                    "confidence": "", "from_cache": "", "language": "",
                    "elapsed_seconds": round(time.time() - started, 1),
                    "status": "error"}

        if resp.status_code == 200:
            data = resp.json()
            sources = data.get("sources") or []
            return {
                "answer": data.get("answer", ""),
                "sources": "; ".join(s.get("source", "") for s in sources),
                "confidence": data.get("confidence", ""),
                "from_cache": data.get("from_cache", ""),
                "language": data.get("detected_language", ""),
                "elapsed_seconds": round(time.time() - started, 1),
                "status": "ok",
            }

        # 429 is the provider saying "slow down", not an answer. Waiting is the
        # only correct response; writing it into the results is not.
        if resp.status_code == 429 and attempt + 1 < RATE_LIMIT_ATTEMPTS:
            wait = RATE_LIMIT_WAITS[min(attempt, len(RATE_LIMIT_WAITS) - 1)]
            print(f"    rate limited - waiting {wait}s "
                  f"(attempt {attempt + 1}/{RATE_LIMIT_ATTEMPTS})")
            time.sleep(wait)
            continue

        return {"answer": f"[HTTP {resp.status_code}] {resp.text[:300]}",
                "sources": "", "confidence": "", "from_cache": "",
                "language": "",
                "elapsed_seconds": round(time.time() - started, 1),
                "status": "rate_limited" if resp.status_code == 429 else "error"}

    return {"answer": "[RATE LIMITED] gave up after "
                      f"{RATE_LIMIT_ATTEMPTS} attempts",
            "sources": "", "confidence": "", "from_cache": "", "language": "",
            "elapsed_seconds": round(time.time() - started, 1),
            "status": "rate_limited"}


def already_answered(path):
    """Questions in an existing CSV that have a real answer worth keeping."""
    if not os.path.exists(path):
        return {}
    done = {}
    try:
        # utf-8-sig also reads a BOM-less file, so --resume and --compare work
        # against both the old CSVs and the new ones.
        with open(path, "r", newline="", encoding="utf-8-sig") as handle:
            for row in csv.DictReader(handle):
                answer = (row.get("answer") or "").strip()
                if answer and not answer.startswith("["):
                    done[row.get("question", "")] = row
    except (OSError, csv.Error):
        return {}
    return done


def summarise(rows):
    total = len(rows)
    if not total:
        return
    ok = [r for r in rows if r["status"] == "ok"]
    throttled = [r for r in rows if r["status"] == "rate_limited"]
    errors = [r for r in rows if r["status"] == "error"]
    not_found = [r for r in ok if "could not find" in r["answer"].lower()
                 or "n'ai pas trouv" in r["answer"].lower()]
    french = [r for r in ok if r["language"] == "fr"]
    french_found = [r for r in french if r not in not_found]

    print("\n" + "=" * 68)
    print("SUMMARY")
    print("=" * 68)
    print(f"  answered            : {len(ok)} of {total}")
    print(f"  of those, not found : {len(not_found)}"
           f"  ({100 * len(not_found) // max(len(ok), 1)}%)")
    if french:
        print(f"  French questions    : {len(french)}, answered "
              f"{len(french_found)}")
    if throttled:
        print(f"  RATE LIMITED        : {len(throttled)}  <- rerun with "
              f"--resume once quota recovers")
    if errors:
        print(f"  errors              : {len(errors)}")
    timings = [float(r["elapsed_seconds"]) for r in ok if r["elapsed_seconds"]]
    if timings:
        timings.sort()
        print(f"  seconds per answer  : median "
              f"{timings[len(timings) // 2]:.0f}, slowest {timings[-1]:.0f}")


def compare(current_rows, old_path):
    old = already_answered(old_path)
    if not old:
        print(f"\nNothing usable to compare in {old_path}")
        return
    gained, lost = [], []
    for row in current_rows:
        previous = old.get(row["question"])
        if not previous:
            continue
        was_found = not (previous.get("answer", "") or "").lower().startswith(
            ("i could not find", "je n'ai pas trouv"))
        now_found = not row["answer"].lower().startswith(
            ("i could not find", "je n'ai pas trouv"))
        if now_found and not was_found:
            gained.append(row["question"])
        elif was_found and not now_found:
            lost.append(row["question"])

    print("\n" + "=" * 68)
    print(f"COMPARED WITH {old_path}")
    print("=" * 68)
    print(f"  now answered, previously not : {len(gained)}")
    for q in gained[:10]:
        print(f"    + {q[:70]}")
    print(f"  previously answered, now not : {len(lost)}")
    for q in lost[:10]:
        print(f"    - {q[:70]}")
    if lost:
        print("\n  Those regressions are the ones to look at first.")


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    force_refresh = "--force-refresh" in sys.argv
    resume = "--resume" in sys.argv
    compare_with = None
    if "--compare" in sys.argv:
        index = sys.argv.index("--compare")
        if index + 1 < len(sys.argv):
            compare_with = sys.argv[index + 1]
            args = [a for a in args if a != compare_with]

    questions_file = args[0] if args else DEFAULT_QUESTIONS_FILE
    output_file = args[1] if len(args) >= 2 else DEFAULT_OUTPUT_FILE

    preflight()

    questions = load_questions(questions_file)
    print(f"Questions: {len(questions)} from {questions_file}")

    kept = already_answered(output_file) if resume else {}
    todo = [q for q in questions if q not in kept]
    if resume:
        print(f"Resuming : {len(kept)} already answered, {len(todo)} to go")
    if force_refresh:
        print("Cache    : bypassed (--force-refresh)")
    print(f"Output   : {output_file}, flushed after every question\n")

    rows = []
    started = time.time()
    temporary = output_file + ".partial"

    # utf-8-sig, not utf-8: Excel reads a BOM-less CSV as Windows-1252, so
    # every French answer opens as "obligations de la circulaire CSSF" with
    # accents turned into mojibake. The BOM costs three bytes and makes the
    # file open correctly by double-click, which is how it is actually read.
    with open(temporary, "w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDNAMES)
        writer.writeheader()

        for position, question in enumerate(questions, start=1):
            if question in kept:
                row = {k: kept[question].get(k, "") for k in FIELDNAMES}
                row["#"] = position
                row.setdefault("status", "ok")
                row["status"] = row["status"] or "ok"
                rows.append(row)
                writer.writerow(row)
                handle.flush()
                continue

            print(f"[{position}/{len(questions)}] {question[:78]}")
            result = ask(question, force_refresh)
            row = {"#": position, "question": question, **result}
            rows.append(row)
            writer.writerow(row)
            handle.flush()

            flag = "CACHED" if result["from_cache"] else "fresh"
            print(f"    {flag}, {result['elapsed_seconds']}s: "
                  f"{result['answer'][:100]}")

            if PAUSE_BETWEEN and result["status"] == "ok":
                time.sleep(PAUSE_BETWEEN)

    os.replace(temporary, output_file)

    print(f"\nFinished {len(questions)} questions in "
          f"{(time.time() - started) / 60:.1f} min -> {output_file}")
    summarise(rows)
    if compare_with:
        compare(rows, compare_with)


if __name__ == "__main__":
    main()
