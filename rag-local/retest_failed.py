import sys
sys.path.insert(0, '.')
import requests
import time

questions = [
    ("Q3", "Quelles recommandations sont données pour la conformité LCB-FT dans le document Risk in Private Equity ?"),
    ("Q8", "Quelles étapes sont nécessaires pour compléter une évaluation dans le document Assessments Creation and Completion ?"),
    ("Q9", "Quels sont les délais de réalisation d'une évaluation mentionnés dans le document Assessments ?"),
    ("Q11", "Quelles sont les recommandations ou conclusions principales du document RC-2324-477-01 ?"),
    ("Q12", "Qui est le destinataire du document RC-2324-477-01 ?"),
    ("Q17", "Quels sont les points de contrôle principaux à vérifier dans le document T5 Group audit instructions ?"),
    ("Q18", "Quelle est la fréquence des audits recommandée dans le document T5 Group audit instructions ?"),
]

for qid, question in questions:
    print(f"\n{'=' * 60}")
    print(f"{qid} : {question}")
    print(f"{'=' * 60}")
    try:
        r = requests.post("http://127.0.0.1:8000/ask-azure", json={"query": question, "lang": "fr"}, timeout=180)
        if r.status_code == 200:
            data = r.json()
            print(f"Score: {data.get('confidence_score')}")
            print(f"Réponse: {data.get('answer', '')}")
        else:
            print(f"ERREUR {r.status_code}")
    except Exception as e:
        print(f"EXCEPTION: {e}")
    time.sleep(6)