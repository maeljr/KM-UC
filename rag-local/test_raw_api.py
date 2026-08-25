from azure.identity import DeviceCodeCredential
import requests

credential = DeviceCodeCredential(tenant_id='hacapartners.onmicrosoft.com', client_id='04b07795-8ddb-461a-bbee-02f9e1bf7b46')
token = credential.get_token('https://cognitiveservices.azure.com/.default').token

url = 'https://aif-haca-shared-dev.services.ai.azure.com/openai/deployments/gpt-5.4/chat/completions?api-version=2024-10-21'
headers = {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}

prompt = """Règles :
- Réponds UNIQUEMENT à partir des extraits fournis.
- Structure ta réponse de façon complète. Va jusqu'au bout de chaque point sans tronquer.
- Utilise des puces.

Question : Quelles sont les étapes nécessaires pour compléter une évaluation ?

Extraits :
[1] Document : Assessments.pdf
Étape 1 : Ouvrir Assessment List depuis la sidebar.
Étape 2 : Cliquer sur Create Assessment.
Étape 3 : Lancer l'évaluation en renseignant le périmètre.
Étape 4 : Cliquer sur Create pour valider.
Étape 5 : Envoyer une invitation au client si Email Invitation est activé.
Étape 6 : Revenir à l'Assessment List pour ouvrir la roue d'action.
Étape 7 : Compléter l'évaluation pour le client.
Étape 8 : Soumettre l'évaluation terminée.

Réponse :"""

body = {
    'messages': [{'role': 'user', 'content': prompt}],
    'max_completion_tokens': 2500,
    'temperature': 0.0
}

r = requests.post(url, headers=headers, json=body, timeout=180)
print('Status:', r.status_code)
if r.status_code == 200:
    data = r.json()
    content = data['choices'][0]['message']['content']
    print('Longueur réponse:', len(content))
    print('Finish reason:', data['choices'][0].get('finish_reason'))
    print('Réponse complète :')
    print(content)
else:
    print(r.text[:500])
