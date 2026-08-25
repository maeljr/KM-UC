import sys
sys.path.insert(0, '.')
from azure_search import SEARCH_ENDPOINT, SEARCH_INDEX, SEARCH_API_KEY, SEARCH_API_VERSION
import requests

for lib in ['Consulting', 'RC', 'haca-demy', '']:
    url = f'{SEARCH_ENDPOINT}/indexes/{SEARCH_INDEX}/docs/search?api-version={SEARCH_API_VERSION}'
    headers = {'Content-Type': 'application/json', 'api-key': SEARCH_API_KEY}
    if lib:
        filtre = f"library eq '{lib}'"
    else:
        filtre = "library eq null or library eq ''"
    body = {
        'search': '*',
        'filter': filtre,
        'top': 100,
        'select': 'parentId,name,url,library',
        'orderby': 'ingestedAt desc'
    }
    r = requests.post(url, headers=headers, json=body)
    if r.status_code == 200:
        docs = r.json().get('value', [])
        label = lib if lib else '(vide)'
        print(f'=== {label} ===')
        seen = set()
        for d in docs:
            pid = d.get('parentId')
            if pid and pid not in seen:
                seen.add(pid)
                print(' ', d.get('name'))
                print('   URL:', (d.get('url') or '')[:120])
            if len(seen) >= 5:
                break
        print()
    else:
        print('Erreur', r.status_code, r.text[:200])
