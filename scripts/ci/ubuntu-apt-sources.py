#!/usr/bin/env python3
"""Use official HTTPS archives on the ephemeral x64 Ubuntu UI-test runner.

runner-images' apt-mirrors.txt can fall back for InRelease but select the
stalled Azure mirror again for Packages. Replace only known Ubuntu URI tokens,
not suites, components, architectures, signatures, comments or other repos.
"""
import argparse
from pathlib import Path
import re
import sys


MIRROR = "mirror+file:/etc/apt/apt-mirrors.txt"
DIRECT = re.compile(
    r"https?://(azure\.archive|archive|security)\.ubuntu\.com/ubuntu(/?)\Z"
)
LEGACY = re.compile(r"^(\s*deb(?:-src)?\s+(?:\[[^\]\r\n]*\]\s+)?)(\S+)")
FIELD = re.compile(r"^([A-Za-z][A-Za-z0-9-]*):[ \t]*(.*)")


def normalize_uri(uri):
    if uri == MIRROR:
        return "https://archive.ubuntu.com/ubuntu/"
    match = DIRECT.fullmatch(uri)
    if match:
        host = "security" if match[1] == "security" else "archive"
        return f"https://{host}.ubuntu.com/ubuntu{match[2]}"
    return uri


def deb822_stanza(text, transform):
    """Retain original lines; only rewrite tokens inside active URIs fields."""
    lines = text.splitlines(keepends=True)
    fields = {}
    current = None
    for index, line in enumerate(lines):
        if line.startswith("#"):
            continue
        if line[0:1] in (" ", "\t") and current is not None:
            fields[current].append((index, 0, line.strip()))
            continue
        match = FIELD.match(line)
        if not match or match[1].lower() in fields:
            raise ValueError("Unsupported or duplicate deb822 field")
        current = match[1].lower()
        fields[current] = [(index, match.start(2), match[2].strip())]
    enabled = " ".join(value for _, _, value in fields.get("enabled", []))
    if enabled.lower() == "no":
        return text
    if enabled and enabled.lower() != "yes":
        raise ValueError("Unsupported deb822 Enabled value")
    for index, start, _ in fields.get("uris", []):
        line = lines[index]
        lines[index] = line[:start] + re.sub(r"\S+", lambda m: transform(m[0]), line[start:])
    return "".join(lines)


def normalize_sources(text, suffix, transform=normalize_uri):
    if suffix == ".sources":
        # Keep paragraph separators byte-for-byte, including CRLF.
        return "".join(part if re.fullmatch(r"(?:[ \t]*\r?\n)+", part)
                       else deb822_stanza(part, transform)
                       for part in re.split(r"((?:^[ \t]*\r?\n)+)", text, flags=re.M)
                       if part)
    if suffix == ".list":
        return "".join(LEGACY.sub(lambda m: m[1] + transform(m[2]), line, count=1)
                       for line in text.splitlines(keepends=True))
    raise ValueError(f"Unsupported source format: {suffix}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apt-root", required=True, type=Path)
    root = parser.parse_args().apt_root
    paths = [root / "sources.list"]
    parts = root / "sources.list.d"
    if parts.is_symlink():
        raise ValueError("Refusing symlinked sources.list.d")
    paths += sorted(parts.glob("*.list")) + sorted(parts.glob("*.sources"))
    pending = []
    recognized = False

    def visit_uri(uri):
        nonlocal recognized
        recognized |= uri == MIRROR or DIRECT.fullmatch(uri) is not None
        return normalize_uri(uri)

    for path in paths:
        if path.is_symlink():
            raise ValueError(f"Refusing symlinked source: {path}")
        if not path.exists():
            continue
        text = path.read_bytes().decode("utf-8")
        normalized = normalize_sources(text, path.suffix, visit_uri)
        if normalized != text:
            pending.append((path, normalized))
    if not recognized:
        raise ValueError("No active supported Ubuntu archive URI; refusing to guess")
    # Validate every source before writing any; no backups or unrelated files touched.
    for path, text in pending:
        path.write_bytes(text.encode("utf-8"))
        print(f"Normalized Ubuntu archive URIs: {path}")
    print(f"Ubuntu HTTPS sources ready ({len(pending)} files changed)")


if __name__ == "__main__":
    try:
        main()
    except (OSError, UnicodeError, ValueError) as error:
        sys.exit(str(error))
