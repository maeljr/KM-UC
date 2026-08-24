from azure.identity import DeviceCodeCredential
import requests

credential = DeviceCodeCredential(
    tenant_id='hacapartners.onmicrosoft.com',
    client_id='04b07795-8ddb-461a-bbee-02f9e1bf7b46'
)
token = credential.get_token('https://management.azure.com/.default').token

# Liste des déploiements via Azure Management API
subscription_id = ''
resource_group = ''
account_name = 'aif-haca-shared-dev'

# D'abord, essayons l'API OpenAI directe avec l'endpoint deployments
url = 'https://aif-haca-shared-dev.openai.azure.com/openai/deployments?api-version=2024-10-21'
headers = {
    'Authorization': f'Bearer {token}',
    'api-key': ''  
}

# Essayons avec juste le token
response = requests.get(url, headers=headers)
print('Status: ' + str(response.status_code))
print('Response: ' + response.text[:500])
