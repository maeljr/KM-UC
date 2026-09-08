import re
with open(r'C:\Dev\HACA\KM%20UC\old_main.py', 'r', encoding='latin-1') as f:
    content = f.read()
for pattern in ['ask-azure', '/repository', 'ask_azure_endpoint', 'repository_endpoint']:
    for m in re.finditer(pattern, content):
        line_num = content[:m.start()].count('\n') + 1
        print(f'{line_num}: {pattern}')
