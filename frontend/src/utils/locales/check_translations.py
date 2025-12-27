import os
import re

locales_dir = '../locales'
en_file = os.path.join(locales_dir, 'en.ts')

def extract_keys(file_path):
    keys = set()
    with open(file_path, 'r', encoding='utf-8') as f:
        for line in f:
            match = re.search(r'^\s*(\w+):', line)
            if match:
                keys.add(match.group(1))
    return keys

en_keys = extract_keys(en_file)
print(f"Found {len(en_keys)} keys in en.ts")

missing_report = {}

for filename in os.listdir(locales_dir):
    if filename == 'en.ts' or not filename.endswith('.ts'):
        continue
    
    file_path = os.path.join(locales_dir, filename)
    keys = extract_keys(file_path)
    
    missing = en_keys - keys
    if missing:
        missing_report[filename] = missing

if not missing_report:
    print("All good! No missing keys found.")
else:
    for filename, missing in missing_report.items():
        print(f"\nMissing keys in {filename}:")
        for key in sorted(missing):
            print(f" - {key}")
