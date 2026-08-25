import sys
sys.path.insert(0, '.')
import requests
from azure_search import SEARCH_ENDPOINT, SEARCH_INDEX, SEARCH_API_KEY, SEARCH_API_VERSION

def get_doc_content(parent_id):
    url = f'{SEARCH_ENDPOINT}/indexes/{SEARCH_INDEX}/docs/search?api-version={SEARCH_API_VERSION}'
    headers = {'Content-Type': 'application/json', 'api-key': SEARCH_API_KEY}
    body = {
        'search': '*',
        'filter': f"parentId eq '{parent_id}'",
        'top': 100,
        'select': 'content,chunkIndex,parentId,name',
        'orderby': 'chunkIndex asc'
    }
    r = requests.post(url, headers=headers, json=body)
    if r.status_code == 200:
        chunks = r.json().get('value', [])
        text = '\n\n'.join([c.get('content', '') for c in chunks])
        return text
    return None

text = get_doc_content('Risk in Private Equity - Oct 2015')
print('Longueur:', len(text) if text else 0)
print('Aperçu:', text[:500] if text else 'Non trouvé')
