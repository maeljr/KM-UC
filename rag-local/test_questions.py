"""
Test des 24 questions sur le RAG Azure AI Search.
Affiche les questions et réponses dans le terminal.
"""

import sys
sys.path.insert(0, '.')
import requests
import time
import json

# Les 24 questions organisées par document
questions = [
    # Document 1 - Risk in Private Equity
    ("Risk in Private Equity", "Quels sont les principaux risques spécifiques au private equity identifiés dans le document Risk in Private Equity ?"),
    ("Risk in Private Equity", "Quelle est la différence entre le risque de liquidité en private equity et en public equity ?"),
    ("Risk in Private Equity", "Quelles recommandations sont données pour la conformité LCB-FT dans ce document ?"),
    
    # Document 2 - Signed Report Amethis
    ("Signed Report Amethis", "Quel est l'objet du rapport signé pour Amethis Investment Fund Manager ?"),
    ("Signed Report Amethis", "Quelles sont les conclusions principales de l'audit d'Amethis ?"),
    ("Signed Report Amethis", "Quel est le montant des actifs sous gestion d'Amethis mentionné dans le rapport ?"),
    
    # Document 3 - Assessments Creation
    ("Assessments Creation", "Quelle est la procédure de création d'une évaluation décrite dans le document Assessments ?"),
    ("Assessments Creation", "Quelles étapes sont nécessaires pour compléter une évaluation ?"),
    ("Assessments Creation", "Quels sont les délais de réalisation d'une évaluation mentionnés ?"),
    
    # Document 4 - RC-2324-477-01
    ("RC-2324-477-01", "Quel est l'objet du document RC-2324-477-01 ?"),
    ("RC-2324-477-01", "Quelles sont les recommandations ou conclusions principales de ce document ?"),
    ("RC-2324-477-01", "Qui est le destinataire de ce document ?"),
    
    # Document 5 - INDUNA AML
    ("INDUNA AML", "Quels sont les concepts clés de la lutte anti-blanchiment présentés dans la formation INDUNA ?"),
    ("INDUNA AML", "Quelles sont les sanctions administratives et pénales en cas de non-conformité AML ?"),
    ("INDUNA AML", "Quelle est la date d'entrée en vigueur de la réforme fiscale mentionnée ?"),
    
    # Document 6 - T5 Group audit
    ("T5 Group Audit", "Quelles sont les instructions données pour l'audit du groupe T5 ?"),
    ("T5 Group Audit", "Quels sont les points de contrôle principaux à vérifier selon ce document ?"),
    ("T5 Group Audit", "Quelle est la fréquence des audits recommandée ?"),
    
    # Document 7 - Template Engagement SA SICAV
    ("Template Engagement SICAV", "Quel est l'objet du template d'engagement letter pour SA SICAV SIF ?"),
    ("Template Engagement SICAV", "Quelles sont les clauses principales de cette lettre de mission ?"),
    ("Template Engagement SICAV", "Quelles sont les obligations du réviseur mentionnées ?"),
    
    # Document 8 - Eurazeo offre
    ("Eurazeo Offre", "Quelles sont les prestations proposées à Eurazeo dans cette offre de service ?"),
    ("Eurazeo Offre", "Quelles sont les références de HACA Partners mentionnées dans l'offre ?"),
    ("Eurazeo Offre", "Quelle est la durée de la mission proposée ?"),
]

def ask_rag(question, lang="fr"):
    """Pose une question au RAG."""
    try:
        r = requests.post(
            "http://127.0.0.1:8000/ask-azure",
            json={"query": question, "lang": lang},
            timeout=180
        )
        if r.status_code == 200:
            data = r.json()
            answer = data.get("answer", "PAS DE REPONSE")
            confidence = data.get("confidence_score", "?")
            sources = data.get("sources", [])
            return answer, confidence, sources
        else:
            return f"ERREUR {r.status_code}", 0, []
    except Exception as e:
        return f"EXCEPTION: {str(e)}", 0, []

# Affichage des résultats
print("=" * 80)
print(f"TEST RAG — {len(questions)} questions")
print("=" * 80)

for i, (doc, question) in enumerate(questions, 1):
    print(f"\n\n{'#' * 80}")
    print(f"QUESTION {i}/{len(questions)} [{doc}]")
    print(f"{'#' * 80}")
    print(f"Q: {question}")
    
    answer, confidence, sources = ask_rag(question)
    
    print(f"\nScore de confiance: {confidence}")
    print(f"Réponse :")
    print(answer)
    
    if sources:
        print(f"\nSources ({len(sources)}):")
        for s in sources[:3]:
            print(f"  - {s.get('source', '?')} (chunk {s.get('chunk_index', '?')})")
    
    print(f"\n{'=' * 80}")
    
    # Délai entre les questions pour éviter les rate limits
    if i < len(questions):
        time.sleep(6)

print(f"\n\nTest terminé : {len(questions)} questions posées.")