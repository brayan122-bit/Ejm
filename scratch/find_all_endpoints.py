with open(r'C:\Users\bherrera\.gemini\antigravity-ide\brain\b200e493-d262-4e69-a0ac-6fab0d6c3db2\scratch\node_modules\@vercel\blob\dist\chunk-GPSPCQKX.js', 'r', encoding='utf-8') as f:
    c = f.read()

import re
matches = re.findall(r'https?://[a-zA-Z0-9_\-\.\/]+', c)
for m in set(matches):
    if 'vercel' in m or 'blob' in m or 'storage' in m:
        print("Endpoint found:", m)
