"""Read results.csv back and print the numbers worth quoting.

    cd C:\\chunk\\rag-local
    python summarise_results.py

batch_test.py prints a summary when it finishes, but that scrolls away and the
figure ends up in a slide from memory. This reads the file, so the number in
the presentation is the number in the file.
"""

import csv
import os
import sys

PATH = sys.argv[1] if len(sys.argv) > 1 else "results.csv"

# The model is instructed to say this rather than guess when the documents do
# not cover the question. Both languages, because the answer follows the
# question's language.
DECLINE_MARKERS = (
    "could not find this information",
    "not found in the documents",
    "do not provide",
    "n'ai pas trouv",
    "ne fournissent pas",
    "pas trouv",
)

if not os.path.exists(PATH):
    sys.exit(f"{PATH} not found. Run  python batch_test.py  first.")

with open(PATH, "r", newline="", encoding="utf-8-sig") as handle:
    rows = list(csv.DictReader(handle))

if not rows:
    sys.exit(f"{PATH} has a header but no rows.")


def is_decline(answer):
    low = (answer or "").lower()
    return any(marker in low for marker in DECLINE_MARKERS)


def as_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


answered = [r for r in rows if (r.get("answer") or "").strip()]
errors = [r for r in rows if (r.get("status") or "").strip().lower() not in ("", "ok")]
declines = [r for r in answered if is_decline(r.get("answer"))]
substantive = [r for r in answered if r not in declines]
cited = [r for r in substantive if (r.get("sources") or "").strip()]
uncited = [r for r in substantive if not (r.get("sources") or "").strip()]
cached = [r for r in rows if str(r.get("from_cache")).strip().lower() in ("true", "1")]
french = [r for r in rows if (r.get("language") or "").strip().lower() == "fr"]
french_answered = [r for r in french if r not in declines and (r.get("answer") or "").strip()]

times = sorted(t for t in (as_float(r.get("elapsed_seconds")) for r in rows) if t is not None)
median = times[len(times) // 2] if times else None

print()
print(f"  {PATH}")
print(f"  {'-' * 52}")
print(f"  questions              : {len(rows)}")
print(f"  answered, no error     : {len(answered)}")
if errors:
    print(f"  errors                 : {len(errors)}   <- worth explaining")
print(f"  substantive answers    : {len(substantive)}")
print(f"  ...of those, cited     : {len(cited)}")
if uncited:
    print(f"  ...substantive, NO cite: {len(uncited)}  <- these are the risky ones")
print(f"  declined (not in docs) : {len(declines)}")
print(f"  French questions       : {len(french)}, of which answered {len(french_answered)}")
if median is not None:
    print(f"  median seconds         : {median:.0f}")
    print(f"  slowest                : {times[-1]:.0f}")
print()

# The caveat that decides whether the figure means anything. A run served from
# cache is a re-check of old answers, not a measurement of the system as it
# stands today.
share = (100 * len(cached) / len(rows)) if rows else 0
if cached:
    print(f"  CAVEAT: {len(cached)} of {len(rows)} answers ({share:.0f}%) came from the")
    print("  cache, so this is a re-check rather than a fresh measurement.")
    print("  For a clean baseline:  python batch_test.py --force-refresh")
else:
    print("  Every answer was generated fresh - no cache. This is a clean")
    print("  baseline and the figures above can be quoted as they stand.")
print()

if declines:
    print("  Declined questions - these are gaps in the document set, not")
    print("  failures of the system:")
    for row in declines:
        print(f"    - {(row.get('question') or '')[:88]}")
    print()
