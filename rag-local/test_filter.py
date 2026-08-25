import sys
sys.path.insert(0, '.')
import requests
from azure_search import SEARCH_ENDPOINT, SEARCH_INDEX, SEARCH_API_KEY, SEARCH_API_VERSION

url = f'{SEARCH_ENDPOINT}/indexes/{SEARCH_INDEX}/docs/search?api-version={SEARCH_API_VERSION}'
headers = {'Content-Type': 'application/json', 'api-key': SEARCH_API_KEY}

# Tester le filtre avec le nom exact
filter_name = "name eq 'RC-2324-477-01.pdf'"
body = {
    'search': '*',
    'filter': filter_name,
    'top': 3,
    'select': 'name,parentId'
}
r = requests.post(url, headers=headers, json=body)
print('Test filtre name:')
print('Status:', r.status_code)
if r.status_code == 200:
    results = r.json().get('value', [])
    print(f'{len(results)} résultats')
    for res in results:
        print(f"  name: {res.get('name')}")
        print(f"  parentId: {res.get('parentId')}")
else:
    print(r.text[:300])
