with open(r'C:\Users\bherrera\.gemini\antigravity-ide\brain\b200e493-d262-4e69-a0ac-6fab0d6c3db2\scratch\node_modules\@vercel\blob\dist\client.js', 'r', encoding='utf-8') as f:
    code = f.read()

idx = code.find('async function upload(')
if idx != -1:
    print(code[idx:idx+1500])
else:
    print("upload not found directly, looking for export")
    idx = code.find('upload =')
    if idx != -1:
        print(code[idx:idx+1500])
