import sys
sys.path.insert(0, '.')
from azure_search import search_azure, detect_document_filter

question = "Quelles sont les recommandations du document RC-2324-477-01 ?"

# Étape 1 : Vérifier le filtre détecté
doc_filter = detect_document_filter(question)
print('Question:', question)
print('Filtre détecté:', doc_filter)

# Étape 2 : Vérifier les passages retournés
passages = search_azure(question)
print(f'\n{len(passages)} passages retournés:')
for p in passages:
    print(f"  - {p['name']} (chunk {p['chunkIndex']})")
