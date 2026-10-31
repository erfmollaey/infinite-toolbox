"""Shared fixtures for EnvGuard tests.

Fixtures never contain real credentials: every value used here is a made-up
placeholder used solely to prove that values are never printed.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

FAKE_SECRET = "sk-test-DO-NOT-LEAK-12345"
FAKE_DB_URL = "postgres://user:hunter2@localhost:5432/app"


@pytest.fixture
def project(tmp_path: Path) -> Path:
    """A small project with source references, a template, and a real .env."""
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "app.py").write_text(
        "import os\n"
        "\n"
        "def config() -> None:\n"
        '    url = os.getenv("DATABASE_URL")\n'
        '    secret = os.environ["JWT_SECRET"]\n'
        "    print(url, secret)\n",
        encoding="utf-8",
    )
    (tmp_path / "web").mkdir()
    (tmp_path / "web" / "client.ts").write_text(
        "const api = process.env.NEXT_PUBLIC_API_URL;\n"
        "console.log(api, process.env.UNUSED_BY_CODE_IS_FINE);\n",
        encoding="utf-8",
    )
    (tmp_path / ".env.example").write_text("DATABASE_URL=\nUNUSED_VAR=\n", encoding="utf-8")
    (tmp_path / ".env").write_text(
        f"DATABASE_URL={FAKE_DB_URL}\nJWT_SECRET={FAKE_SECRET}\n", encoding="utf-8"
    )
    return tmp_path


def git(path: Path, *args: str) -> subprocess.CompletedProcess[str]:
    """Run git in a test repository without requiring user identity or commits."""
    return subprocess.run(
        ["git", "-C", str(path), *args],
        capture_output=True,
        text=True,
        check=True,
    )


@pytest.fixture
def git_repo(project: Path) -> Path:
    """The fixture project as an initialized Git repository (no commits needed)."""
    git(project, "init", "-q")
    return project
