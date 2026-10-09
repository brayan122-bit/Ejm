import os, re

files = [f for f in os.listdir('.') if f.endswith('.js') or f.endswith('.html') or f.endswith('.css')]

print("=== CHECKING IFRAMES, EMBEDS, OBJECTS ===")
for f in files:
    c = open(f, 'r', encoding='utf-8', errors='ignore').read()
    for tag in ['<iframe', '<embed', '<object', 'createElement("iframe")', "createElement('iframe')"]:
        if tag.lower() in c.lower():
            print(f"{f}: found {tag}")

print("\n=== CHECKING BLOB: URLS AND URL.createObjectURL ===")
for f in files:
    c = open(f, 'r', encoding='utf-8', errors='ignore').read()
    if 'createobjecturl' in c.lower() or 'blob:' in c.lower():
        matches = re.findall(r'createObjectURL\([^)]+\)|blob:[^\s"\'>]+', c, re.I)
        print(f"{f}: {matches[:3]}")

print("\n=== CHECKING WEB WORKERS ===")
for f in files:
    c = open(f, 'r', encoding='utf-8', errors='ignore').read()
    if 'worker' in c.lower():
        matches = re.findall(r'new\s+Worker\([^)]+\)', c)
        if matches:
            print(f"{f}: {matches}")

print("\n=== CHECKING EXTERNAL FONTS ===")
for f in files:
    c = open(f, 'r', encoding='utf-8', errors='ignore').read()
    if 'font' in c.lower():
        urls = re.findall(r'https?://[^\s"\'>]+font[^\s"\'>]*', c, re.I)
        if urls:
            print(f"{f}: {urls}")
