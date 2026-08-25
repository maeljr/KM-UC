import sys
sys.path.insert(0, '.')
import requests
from azure_search import SEARCH_ENDPOINT, SEARCH_INDEX, SEARCH_API_KEY, SEARCH_API_VERSION

url = f'{SEARCH_ENDPOINT}/indexes/{SEARCH_INDEX}/docs/search?api-version={SEARCH_API_VERSION}'
headers = {'Content-Type': 'application/json', 'api-key': SEARCH_API_KEY}

names = [
    "Signed_report_Amethis Investment Fund Manager S.A._31.12.17.pdf",
    "01. Assessments - Creation and Completion.pdf",
    "RC-2324-477-01.pdf",
    "INDUNA - Anti-money laundering and counter-terrorist financing 171220.pptx",
    "T5 Group audit instructions GAI MAM Update 2018.docx",
    "Template - Engagement letter SA SICAV SIF.DOCX",
    "Eurazeo France - Offre de service - Externalisation du contrôle périodique 2026-2028.pdf",
]

for name in names:
    body = {
        'search': '*',
        'filter': f"name eq '{name}'",
        'top': 1,
        'select': 'parentId,name'
    }
    r = requests.post(url, headers=headers, json=body)
    if r.status_code == 200:
        results = r.json().get('value', [])
        if results:
            print(f"OK: {name}")
            print(f"  parentId: {results[0].get('parentId')}")
        else:
            print(f"ABSENT: {name}")
    else:
        print(f"ERREUR {r.status_code} pour {name}")
