"""
Comparaison RAG vs LLM Oracle pour valider la fiabilité des réponses.
Le LLM Oracle a accès au texte intégral du document, le RAG non.
"""

import sys
sys.path.insert(0, '.')
import json
import time
import requests
from azure.identity import DeviceCodeCredential

# Configuration Azure
AZURE_AI_ENDPOINT = "https://aif-haca-shared-dev.services.ai.azure.com"
CHAT_DEPLOYMENT = "gpt-5.4"
API_VERSION = "2024-10-21"

_credential = None
def _get_credential():
    global _credential
    if _credential is None:
        _credential = DeviceCodeCredential(
            tenant_id="hacapartners.onmicrosoft.com",
            client_id="04b07795-8ddb-461a-bbee-02f9e1bf7b46"
        )
    return _credential

def ask_oracle(question, document_text):
    """Pose une question au LLM avec le texte intégral du document."""
    credential = _get_credential()
    token = credential.get_token("https://cognitiveservices.azure.com/.default").token
    url = f"{AZURE_AI_ENDPOINT}/openai/deployments/{CHAT_DEPLOYMENT}/chat/completions?api-version={API_VERSION}"
    
    # Limiter la taille du contexte pour éviter les timeouts
    context = document_text[:50000]
    
    prompt = f"""Voici le texte d'un document. Réponds UNIQUEMENT à partir de ce texte.
Si l'information n'est pas présente, dis-le explicitement.

Document :
{context}

Question : {question}

Réponse :"""
    
    max_retries = 3
    for attempt in range(max_retries):
        credential = _get_credential()
        token = credential.get_token("https://cognitiveservices.azure.com/.default").token
        r = requests.post(url, headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"}, 
                          json={"messages": [{"role": "user", "content": prompt}], "max_completion_tokens": 1500}, timeout=180)
        
        if r.status_code == 429:
            wait_time = (attempt + 1) * 10
            print(f"  ⚠️ Rate limit Oracle, attente {wait_time}s...")
            time.sleep(wait_time)
            continue
        
        if r.status_code == 200:
            return r.json()["choices"][0]["message"]["content"].strip()
        
        return f"ERREUR {r.status_code}: {r.text[:300]}"
    
    return "ERREUR: rate limit persistant"

def ask_rag(question):
    """Pose une question au RAG via l'API locale."""
    r = requests.post("http://127.0.0.1:8000/ask-azure", json={"query": question, "lang": "fr"}, timeout=180)
    if r.status_code == 200:
        data = r.json()
        return data.get("answer", "PAS DE REPONSE")
    else:
        return f"ERREUR {r.status_code}: {r.text[:300]}"

# Les 5 questions de test
questions = [
    "Quels sont les principaux risques spécifiques au private equity identifiés dans ce document ?",
    "Quel pourcentage de perte en capital est observé dans les scénarios de stress ?",
    "Résume les différences entre le risque de liquidité en private equity et en public equity",
    "Que disent les auteurs sur le risque de marché secondaire pendant la crise de 2009 ?",
    "Quelles recommandations sont données pour la conformité LCB-FT ?",
]

# Charger le document
with open("risk_private_equity.txt", "r", encoding="utf-8") as f:
    doc_text = f.read()

print("=" * 80)
print(f"DOCUMENT : Risk in Private Equity - Oct 2015 ({len(doc_text)} caractères)")
print("=" * 80)

for i, q in enumerate(questions, 1):
    print(f"\n\n{'#' * 80}")
    print(f"QUESTION {i} : {q}")
    print(f"{'#' * 80}")
    
    print(f"\n--- RAG (Azure AI Search) ---")
    rag_answer = ask_rag(q)
    print(rag_answer[:1000])
    
    print(f"\n--- LLM ORACLE (texte intégral) ---")
    oracle_answer = ask_oracle(q, doc_text)
    print(oracle_answer[:1000])
    
    print(f"\n{'=' * 80}")
    time.sleep(10)  # Délai entre les questions