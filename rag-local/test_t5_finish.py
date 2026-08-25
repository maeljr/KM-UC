import sys
sys.path.insert(0, '.')
from azure_search import ask_azure

result = ask_azure("Quelles sont les instructions données dans le document T5 Group audit instructions ?")
answer = result['answer']
print(f"Longueur: {len(answer)}")
print(f"Score: {result['confidence_score']}")
print(f"Fin de la réponse: ...{answer[-100:]}")
