import sys
sys.path.insert(0, '.')
import requests
from azure_search import SEARCH_ENDPOINT, SEARCH_INDEX, SEARCH_API_KEY, SEARCH_API_VERSION

def get_doc_by_name(name):
    url = f'{SEARCH_ENDPOINT}/indexes/{SEARCH_INDEX}/docs/search?api-version={SEARCH_API_VERSION}'
    headers = {'Content-Type': 'application/json', 'api-key': SEARCH_API_KEY}
    body = {
        'search': name,
        'top': 5,
        'select': 'parentId,name,content,chunkIndex',
    }
    r = requests.post(url, headers=headers, json=body)
    if r.status_code == 200:
        results = r.json().get('value', [])
        for res in results:
            print('parentId:', res.get('parentId'))
            print('name:', res.get('name'))
            print('chunk:', res.get('chunkIndex'))
            print('content preview:', res.get('content', '')[:200])
            print('---')
    else:
        print('Erreur:', r.status_code, r.text[:300])

get_doc_by_name('Risk in Private Equity')
