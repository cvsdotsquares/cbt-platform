import os
import re
import time
from pathlib import Path

UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", Path(__file__).resolve().parents[2] / "uploads" / "materials"))


def save_material_file(tenant_id: str, file_name: str, content: bytes, mime_type: str) -> str:
    safe_name = f"{int(time.time() * 1000)}-{re.sub(r'[^a-zA-Z0-9._-]', '_', file_name)}"
    tenant_dir = UPLOAD_DIR / tenant_id
    tenant_dir.mkdir(parents=True, exist_ok=True)
    file_path = tenant_dir / safe_name
    file_path.write_bytes(content)
    return str(file_path.resolve())


def read_material_file(file_url: str) -> bytes:
    path = Path(file_url)
    if not path.is_absolute():
        path = Path.cwd() / file_url
    if not path.exists():
        raise FileNotFoundError(file_url)
    return path.read_bytes()


def delete_material_file(file_url: str) -> None:
    path = Path(file_url)
    if not path.is_absolute():
        path = Path.cwd() / file_url
    if path.exists():
        path.unlink()
