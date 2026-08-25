import sys
sys.path.insert(0, '.')
import requests
from azure_search import SEARCH_ENDPOINT, SEARCH_INDEX, SEARCH_API_KEY, SEARCH_API_VERSION

parent_id = '00__Shared_Folders_Amethis_-_Risk_Management_99__Resources_Risk_in_Private_Equity_-_Oct_2015_pdf'

url = f'{SEARCH_ENDPOINT}/indexes/{SEARCH_INDEX}/docs/search?api-version={SEARCH_API_VERSION}'
headers = {'Content-Type': 'application/json', 'api-key': SEARCH_API_KEY}
body = {
    'search': '*',
    'filter': f"parentId eq '{parent_id}'",
    'top': 100,
    'select': 'content,chunkIndex',
    'orderby': 'chunkIndex asc'
}
r = requests.post(url, headers=headers, json=body)
if r.status_code == 200:
    chunks = r.json().get('value', [])
    print('Nombre de chunks:', len(chunks))
    full_text = '\n\n'.join([c.get('content', '') for c in chunks])
    print('Longueur totale:', len(full_text))
    with open('risk_private_equity.txt', 'w', encoding='utf-8') as f:
        f.write(full_text)
    print('Fichier sauvegardé: risk_private_equity.txt')
else:
    print('Erreur:', r.status_code, r.text[:300])
