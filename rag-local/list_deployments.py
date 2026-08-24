from azure.identity import DeviceCodeCredential
import requests

credential = DeviceCodeCredential(
    tenant_id='hacapartners.onmicrosoft.com',
    client_id='04b07795-8ddb-461a-bbee-02f9e1bf7b46'
)
token = credential.get_token('https://cognitiveservices.azure.com/.default').token

# Liste des déploiements disponibles
url = 'https://aif-haca-shared-dev.services.ai.azure.com/openai/deployments?api-version=2025-01-01-preview'
headers = {'Authorization': f'Bearer {token}'}
response = requests.get(url, headers=headers)

if response.status_code == 200:
    data = response.json()
    print('Déploiements disponibles:')
    for dep in data.get('data', []):
        print('  - ' + dep.get('id', dep.get('name', 'inconnu')))
else:
    print('Erreur ' + str(response.status_code) + ': ' + response.text[:300])
