"""Generate a local invitation and send it to Wrangler through stdin."""
from pathlib import Path
import secrets
import subprocess

root = Path(__file__).resolve().parents[1]
target = root / 'data' / 'registration-code.txt'
target.parent.mkdir(exist_ok=True)
if not target.exists():
    target.write_text(secrets.token_urlsafe(24), encoding='utf-8')
code = target.read_text(encoding='utf-8').strip()
result = subprocess.run(
    ['node', str(root / 'node_modules' / 'wrangler' / 'bin' / 'wrangler.js'),
     'secret', 'put', 'REGISTRATION_CODE'],
    input=code + '\n', text=True, cwd=root,
)
if result.returncode:
    raise SystemExit(result.returncode)
print('Invitation saved locally: data/registration-code.txt')
