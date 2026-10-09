with open(r'C:\Users\bherrera\.gemini\antigravity-ide\brain\b200e493-d262-4e69-a0ac-6fab0d6c3db2\scratch\node_modules\@vercel\blob\dist\client.js', 'r', encoding='utf-8') as f:
    code = f.read()

idx = code.find('createPutMethod')
print(code[idx-200:idx+1500])
