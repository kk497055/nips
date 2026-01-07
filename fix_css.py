
import os

source_path = 'd:/NIPS Education/css/style.css'
temp_path = 'd:/NIPS Education/css/style_fixed.css'

with open(source_path, 'rb') as f:
    raw_data = f.read()

# content seems to be a mix. Let's try to decode as utf-8, falling back to latin-1 for bytes that fail
# But actually, the goal is to make it ALL utf-8.
# 'errors="replace"' might lose data.
# The user issue appeared after I appended. The original file was likely UTF-8. 
# My append might have been UTF-16 LE (Windows default).
# Let's try to detect if there is a BOM or mixed content.

try:
    content = raw_data.decode('utf-8')
except UnicodeDecodeError:
    # It failed. Let's try to decode as utf-8 up to the error, and see.
    # Actually, let's just use 'ignore' or 'replace' to get a working file first, 
    # but that might break the checkmarks.
    # Better: read the first part as utf-8, and the last part (my append) might be different.
    
    # Heuristic: split at the known junction point if possible? 
    # No, let's just decode with 'utf-8' errors='ignore' ensures we get text. 
    # Checkmarks might be lost if they were in the corrupted part (unlikely, they were in original).
    # If the original was utf-8, and I appended garbage, only the append is garbage.
    # BUT if I appended UTF-16, it looks like null bytes interspersed.
    
    content = raw_data.decode('utf-8', errors='ignore')

# Now write it back as clean UTF-8
with open(temp_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("File fixed and saved to " + temp_path)
