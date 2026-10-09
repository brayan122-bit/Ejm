import os

scratch = r'C:\Users\bherrera\.gemini\antigravity-ide\brain\b200e493-d262-4e69-a0ac-6fab0d6c3db2\scratch\node_modules\@vercel\blob\dist'

for f in os.listdir(scratch):
    if f.endswith('.js'):
        p = os.path.join(scratch, f)
        c = open(p, 'r', encoding='utf-8', errors='ignore').read()
        if 'createPutMethod' in c:
            print(f"Found in {f}")
            idx = c.find('createPutMethod =')
            if idx == -1: idx = c.find('function createPutMethod')
            if idx != -1:
                print(c[idx:idx+1500])
