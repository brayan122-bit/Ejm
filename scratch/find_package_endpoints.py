import os, re

scratch = r'C:\Users\bherrera\.gemini\antigravity-ide\brain\b200e493-d262-4e69-a0ac-6fab0d6c3db2\scratch\node_modules\@vercel\blob'

for root, dirs, files in os.walk(scratch):
    for f in files:
        if f.endswith('.js') or f.endswith('.cjs'):
            p = os.path.join(root, f)
            with open(p, 'r', encoding='utf-8', errors='ignore') as fp:
                c = fp.read()
            m = re.findall(r'https?://[a-zA-Z0-9_\-\.]*blob[a-zA-Z0-9_\-\.]*', c)
            if m:
                print(f"{f}: {set(m)}")
            m2 = re.findall(r'https?://[a-zA-Z0-9_\-\.]*storage[a-zA-Z0-9_\-\.]*', c)
            if m2:
                print(f"{f} (storage): {set(m2)}")
