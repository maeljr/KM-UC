from azure.identity import DeviceCodeCredential
import requests

credential = DeviceCodeCredential(
    tenant_id='hacapartners.onmicrosoft.com',
    client_id='04b07795-8ddb-461a-bbee-02f9e1bf7b46'
)
token = credential.get_token('https://cognitiveservices.azure.com/.default').token

url = 'https://aif-haca-shared-dev.services.ai.azure.com/openai/deployments/text-embedding-3-large/embeddings?api-version=2025-01-01-preview'
headers = {
    'Authorization': f'Bearer {token}',
    'Content-Type': 'application/json'
}
body = {'input': ['Test de conformite europeenne']}

response = requests.post(url, headers=headers, json=body)

if response.status_code == 200:
    data = response.json()
    dims = len(data['data'][0]['embedding'])
    print('✅ text-embedding-3-large OK - ' + str(dims) + ' dimensions')
    print('   Premieres valeurs: ' + str(data['data'][0]['embedding'][:5]))
else:
    print('❌ Erreur ' + str(response.status_code) + ': ' + response.text[:200])
