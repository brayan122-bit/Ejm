import re

with open('vendor/vercel-blob-client.js', 'r', encoding='utf-8') as f:
    client_code = f.read()

urls = re.findall(r'https?://[a-zA-Z0-9_\-\.]+', client_code)
print("URLs in vendor/vercel-blob-client.js:")
for u in set(urls):
    print(" ", u)
