"""Phase 0 static inventory only: no install, dotenv, DB or service access."""
import hashlib
import json
from pathlib import Path


def main():
    root = Path(__file__).resolve().parents[2]
    paths = ["package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml",
             "apps/web/package.json", "apps/web/pnpm-lock.yaml",
             "apps/workers/package.json", "apps/api/pyproject.toml"]
    manifests = {name: json.loads((root / name).read_text()) for name in
                 paths if name.endswith("package.json")}
    assert manifests["package.json"]["packageManager"] == "pnpm@12.11.2"
    assert manifests["apps/web/package.json"]["name"] == "@stockdepth/web"
    assert manifests["apps/workers/package.json"]["name"] == "@stockdepth/workers"
    workspace = (root / "pnpm-workspace.yaml").read_text()
    assert "apps/web" in workspace and "apps/workers" in workspace
    print(json.dumps({"phase": 0, "scope": "static manifest inventory; not install or test validation",
                      "files": {name: hashlib.sha256((root / name).read_bytes()).hexdigest()
                                for name in paths},
                      "findings": ["Root lock contains two YAML documents; workspace importers exist in the second document and require single-document reconciliation",
                                   "Python dependency ranges are not a reproducible lock",
                                   "Legacy DB/browser scripts require portability and isolation review"]},
                     indent=2))


if __name__ == "__main__":
    main()
