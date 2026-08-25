"""
Récupère des documents depuis Azure AI Search en cherchant par nom.
"""

import sys
sys.path.insert(0, '.')
import requests
from azure_search import SEARCH_ENDPOINT, SEARCH_INDEX, SEARCH_API_KEY, SEARCH_API_VERSION

# On connaît déjà le premier parentId
documents = [
    ("00__Shared_Folders_Amethis_-_Risk_Management_99__Resources_Risk_in_Private_Equity_-_Oct_2015_pdf", "risk_private_equity.txt"),
]

# Pour les autres, on va lister les documents disponibles
url = f'{SEARCH_ENDPOINT}/indexes/{SEARCH_INDEX}/docs/search?api-version={SEARCH_API_VERSION}'
headers = {'Content-Type': 'application/json', 'api-key': SEARCH_API_KEY}

# Chercher par mots-clés dans le nom
keywords = ["Signed_report", "Assessments", "RC-2324", "INDUNA", "T5 Group", "Template - Engagement", "Eurazeo"]
for kw in keywords:
    body = {
        'search': kw,
        'searchFields': 'name',
        'top': 5,
        'select': 'parentId,name'
    }
    r = requests.post(url, headers=headers, json=body)
    if r.status_code == 200:
        results = r.json().get('value', [])
        print(f"=== {kw} ===")
        for res in results:
            print(f"  parentId: {res.get('parentId')}")
            print(f"  name: {res.get('name')}")
            print()