with open(r'C:\Users\bherrera\.gemini\antigravity-ide\brain\b200e493-d262-4e69-a0ac-6fab0d6c3db2\scratch\node_modules\@vercel\blob\dist\chunk-GPSPCQKX.js', 'r', encoding='utf-8') as f:
    c = f.read()

idx = c.find('function requestApi(')
if idx != -1:
    print(c[idx:idx+1500])
else:
    idx = c.find('requestApi =')
    print(c[idx:idx+1500])
