import re

with open(r'C:\Users\bherrera\.gemini\antigravity-ide\brain\b200e493-d262-4e69-a0ac-6fab0d6c3db2\scratch\node_modules\@vercel\blob\dist\client.js', 'r', encoding='utf-8') as f:
    code = f.read()

for match in re.finditer(r'function upload\b|function createUploadUrl\b|getApiUrl\b|blob-api\b', code):
    print(match.group(0), "at", match.start())

for match in re.finditer(r'api\.blob\.vercel-storage\.com|blob\.vercel-storage\.com', code):
    print("Found exact host:", match.group(0))

# Search for any string ending in .com
for s in re.findall(r'["\']https?://[^"\']+["\']', code):
    print("Literal URL:", s)
