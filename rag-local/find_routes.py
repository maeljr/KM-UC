import re
with open(r'C:\Dev\HACA\KM%20UC\rag-local-mael\main.py', 'r', encoding='utf-8') as f:
    lines = f.readlines()
for i, line in enumerate(lines, 1):
    if 'ask-azure' in line or '/repository' in line or 'ask_azure_endpoint' in line or 'repository_endpoint' in line:
        print(f"{i}: {line.rstrip()}")
