import re

for filename in ['admin.html', 'portal.html', 'login.html', 'index.html', 'app.js', 'admin-ui.js', 'portal-ui.js', 'index-app.js']:
    try:
        with open(filename, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        continue
    dialogs = re.findall(r'<dialog[^>]*>.*?</dialog>', content, re.DOTALL)
    if dialogs:
        print(f"=== {filename} has {len(dialogs)} dialog(s) ===")
        for d in dialogs:
            # find id
            id_m = re.search(r'id=["\']([^"\']+)["\']', d)
            did = id_m.group(1) if id_m else 'unknown'
            print(f"  Dialog #{did}:")
            # find buttons
            buttons = re.findall(r'<button[^>]*>.*?</button>', d, re.DOTALL)
            for b in buttons:
                # clean up newlines in button
                b_clean = " ".join(b.split())
                print(f"    Button: {b_clean}")
