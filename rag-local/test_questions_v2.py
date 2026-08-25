"""
Test v2 — 16 questions avec mention explicite du document.
Chaque question déclenche le filtrage par métadonnées.
"""

import sys
sys.path.insert(0, '.')
import requests
import time

questions = [
    # Risk in Private Equity
    ("Risk PE", "Quels sont les principaux risques spécifiques identifiés dans le document Risk in Private Equity ?"),
    ("Risk PE", "Que dit le document Risk in Private Equity sur le marché secondaire pendant la crise de 2009 ?"),
    
    # Signed Report Amethis
    ("Amethis", "Quel est l'objet du rapport signé pour Amethis Investment Fund Manager ?"),
    ("Amethis", "Quelles sont les conclusions principales du rapport signé pour Amethis Investment Fund Manager ?"),
    
    # Assessments Creation
    ("Assessments", "Quelle est la procédure de création d'une évaluation décrite dans le document Assessments Creation and Completion ?"),
    ("Assessments", "Quelles étapes sont nécessaires pour compléter une évaluation selon le document Assessments Creation and Completion ?"),
    
    # RC-2324-477-01
    ("RC Facture", "Quel est le montant total TTC de la facture RC-2324-477-01 ?"),
    ("RC Facture", "Qui est le destinataire de la facture RC-2324-477-01 ?"),
    
    # INDUNA AML
    ("INDUNA", "Quels sont les concepts clés de la lutte anti-blanchiment présentés dans la formation INDUNA ?"),
    ("INDUNA", "Quelles sont les sanctions administratives mentionnées dans la formation INDUNA Anti-money laundering ?"),
    
    # T5 Group Audit
    ("T5", "Quelles sont les instructions données dans le document T5 Group audit instructions ?"),
    ("T5", "Quels sont les points de contrôle principaux à vérifier selon le document T5 Group audit instructions ?"),
    
    # Template Engagement SICAV
    ("Template", "Quel est l'objet du template Engagement letter SA SICAV SIF ?"),
    ("Template", "Quelles sont les clauses principales du template Engagement letter SA SICAV SIF ?"),
    
    # Eurazeo Offre
    ("Eurazeo", "Quelles prestations sont proposées dans l'offre de service Eurazeo ?"),
    ("Eurazeo", "Quelles sont les références de HACA Partners mentionnées dans l'offre de service Eurazeo ?"),
]

def ask_rag(question):
    try:
        r = requests.post("http://127.0.0.1:8000/ask-azure", json={"query": question, "lang": "fr"}, timeout=180)
        if r.status_code == 200:
            data = r.json()
            answer = data.get("answer", "PAS DE REPONSE")
            confidence = data.get("confidence_score", 0)
            sources = data.get("sources", [])
            return answer, confidence, sources
        else:
            return f"ERREUR {r.status_code}", 0, []
    except Exception as e:
        return f"EXCEPTION: {str(e)}", 0, []

print("=" * 80)
print(f"TEST v2 — {len(questions)} questions avec filtrage document")
print("=" * 80)

for i, (doc, question) in enumerate(questions, 1):
    print(f"\n\n{'#' * 80}")
    print(f"QUESTION {i}/{len(questions)} [{doc}]")
    print(f"{'#' * 80}")
    print(f"Q: {question}")
    
    answer, confidence, sources = ask_rag(question)
    
    print(f"\nScore: {confidence}")
    print(f"Réponse :")
    print(answer)
    
    if sources:
        print(f"\nSources ({len(sources)}):")
        for s in sources[:3]:
            print(f"  - {s.get('source', '?')}")
    
    print(f"\n{'=' * 80}")
    
    if i < len(questions):
        time.sleep(6)

print(f"\n\nTest terminé.")