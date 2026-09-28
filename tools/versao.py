#!/usr/bin/env python3
"""Carimba a versão em todos os arquivos (index.html e sw.js).
Uso: python3 tools/versao.py 2.9.0
Cada versão ganha endereços próprios (?v=...), então o navegador nunca mistura
arquivos de versões diferentes — era isso que quebrava o app depois de uma atualização."""
import re, sys, pathlib
v = sys.argv[1]
root = pathlib.Path(__file__).resolve().parent.parent
idx = root / 'index.html'
s = idx.read_text()
s = re.sub(r'((?:src|href)="(?:js|css|vendor)/[^"?]+)(\?v=[^"]*)?"', lambda m: f'{m.group(1)}?v={v}"', s)
s = re.sub(r"window\.PIXELAR_V = '[^']*'", f"window.PIXELAR_V = '{v}'", s)
idx.write_text(s)
sw = root / 'sw.js'
t = sw.read_text()
t = re.sub(r"const VERSION = '[^']*'", f"const VERSION = 'pixelar-{v}'", t)
sw.write_text(t)
print('versão', v)
