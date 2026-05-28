"""
Parse ddsCoords table from tree.lua.
Returns {filename: {asset_name: index}}
"""
import re


def parse_ddscoords(lua_path):
    """Parse ddsCoords from tree.lua."""
    with open(lua_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    match = re.search(r'ddsCoords\s*=\s*\{', content)
    if not match:
        return {}
    
    # Find matching closing brace
    start = match.end() - 1
    depth = 0
    i = start
    while i < len(content):
        if content[i] == '{': depth += 1
        elif content[i] == '}':
            depth -= 1
            if depth == 0: break
        i += 1
    
    return _parse(content[start:i+1])


def _parse(text):
    """Parse top-level table: {["file"]={...}, ...}"""
    result = {}
    text = text.strip()
    if text.startswith('{'): text = text[1:]
    if text.endswith('}'): text = text[:-1]
    
    pos = 0
    while pos < len(text):
        # Skip whitespace and commas
        while pos < len(text) and text[pos] in ' \t\n\r,':
            pos += 1
        if pos >= len(text): break
        
        # Read key
        key = _read_key(text, pos)
        
        # Advance pos past key
        if text[pos] == '[':
            pos = text.index(']', pos) + 1
        elif text[pos] in ('"', "'"):
            quote = text[pos]; pos += 1
            while pos < len(text) and text[pos] != quote: pos += 1
            pos += 1
        else:
            while pos < len(text) and text[pos] not in ' \t\n\r=': pos += 1
        
        # Skip = and whitespace
        while pos < len(text) and text[pos] in ' \t\n\r': pos += 1
        if pos < len(text) and text[pos] == '=': pos += 1
        while pos < len(text) and text[pos] in ' \t\n\r': pos += 1
        
        # Read value (table)
        if pos >= len(text) or text[pos] != '{': break
        depth = 1
        val_start = pos
        pos += 1
        while pos < len(text) and depth > 0:
            if text[pos] == '{': depth += 1
            elif text[pos] == '}': depth -= 1
            pos += 1
        
        inner = _parse_inner(text[val_start:pos])
        if inner:
            result[key] = inner
    
    return result


def _parse_inner(text):
    """Parse inner table: {name=idx, ...}"""
    result = {}
    text = text.strip()
    if text.startswith('{'): text = text[1:]
    if text.endswith('}'): text = text[:-1]
    
    pos = 0
    while pos < len(text):
        while pos < len(text) and text[pos] in ' \t\n\r,':
            pos += 1
        if pos >= len(text): break
        
        key = _read_key(text, pos)
        
        if text[pos] == '[':
            pos = text.index(']', pos) + 1
        elif text[pos] in ('"', "'"):
            quote = text[pos]; pos += 1
            while pos < len(text) and text[pos] != quote: pos += 1
            pos += 1
        else:
            while pos < len(text) and text[pos] not in ' \t\n\r=': pos += 1
        
        while pos < len(text) and text[pos] in ' \t\n\r': pos += 1
        if pos < len(text) and text[pos] == '=': pos += 1
        while pos < len(text) and text[pos] in ' \t\n\r': pos += 1
        
        # Read integer value
        end = pos
        while end < len(text) and text[end] in '0123456789': end += 1
        if end > pos:
            result[key] = int(text[pos:end])
            pos = end
    
    return result


def _read_key(text, pos):
    """Read a Lua key at position. Returns key string."""
    if text[pos] == '[':
        end = text.index(']', pos)
        return text[pos+1:end].strip('"').strip("'")
    elif text[pos] in ('"', "'"):
        quote = text[pos]; p = pos + 1
        end = p
        while end < len(text) and text[end] != quote: end += 1
        return text[p:end]
    else:
        end = pos
        while end < len(text) and text[end] not in ' \t\n\r=': end += 1
        return text[pos:end]
