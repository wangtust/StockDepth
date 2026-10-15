"""Install the pinned Linux amd64 scanner after checking its release checksum."""
import hashlib
from pathlib import Path
import sys
import tarfile
import tempfile
import urllib.request

version = '8.30.1'
sha256 = '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb'
target = Path(sys.argv[1]).resolve()
target.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix='stockdepth-gitleaks-') as directory:
    archive = Path(directory) / 'gitleaks.tar.gz'
    url = f'https://github.com/gitleaks/gitleaks/releases/download/v{version}/gitleaks_{version}_linux_x64.tar.gz'
    with urllib.request.urlopen(url, timeout=60) as response:
        archive.write_bytes(response.read())
    if hashlib.sha256(archive.read_bytes()).hexdigest() != sha256:
        raise RuntimeError('Gitleaks release checksum mismatch')
    with tarfile.open(archive) as package:
        binary = package.extractfile('gitleaks')
        if binary is None:
            raise RuntimeError('Scanner missing from release')
        (target / 'gitleaks').write_bytes(binary.read())
    (target / 'gitleaks').chmod(0o755)
print('Verified gitleaks ' + version)
