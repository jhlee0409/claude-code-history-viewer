#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
cursor-workspace-clean.py — 清理 VS Code 系编辑器（Cursor / Code / Windsurf / Trae ...）
workspaceStorage 中指向已失效路径的工作区缓存目录。

默认 dry-run（只报告不删除），确认无误后加 --apply 执行删除。

用法示例:
  cursor-workspace-clean.py                       # 扫描 Cursor，仅报告
  cursor-workspace-clean.py --apply --trash        # 移到废纸篓（可恢复，推荐）
  cursor-workspace-clean.py --apply                # 直接删除失效项
  cursor-workspace-clean.py --app Code             # 清理 VS Code
  cursor-workspace-clean.py --include-empty        # 连带清理无引用的空窗口存储
  cursor-workspace-clean.py --list                 # 额外列出全部有效项
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import urllib.parse
from pathlib import Path

# 应用名 -> Application Support 下的目录名
KNOWN_APPS = {
    "cursor": "Cursor",
    "code": "Code",
    "windsurf": "Windsurf",
    "trae": "Trae",
    "vscode": "Code",
    "vscode-insiders": "Code - Insiders",
    "vscodium": "VSCodium",
}

STATUS_ORDER = ("MISSING", "PARTIAL", "NO_META", "REMOTE", "OK")

# 永不删除的特殊目录
PROTECTED_DIRS = {"empty-window"}

# 非本地 URI scheme：远程工作区（Codespaces / SSH / WSL / dev-container），无法用本地路径判断有效性
REMOTE_SCHEMES = (
    "vscode-remote://",
    "vscode-vfs://",
    "vscode-userdata://",
    "ssh-remote://",
    "attached-container://",
    "dev-container://",
    "codespace://",
    "wsl://",
)


def is_remote_uri(uri: str) -> bool:
    return uri.lower().startswith(REMOTE_SCHEMES)


def human_size(n: int) -> str:
    f = float(n)
    for unit in ("B", "KB", "MB", "GB"):
        if f < 1024 or unit == "GB":
            return f"{f:.0f} B" if unit == "B" else f"{f:.2f} {unit}"
        f /= 1024
    return f"{n} B"


def dir_size(path: Path) -> int:
    total = 0
    for root, _dirs, files in os.walk(path, onerror=lambda e: None):
        for name in files:
            try:
                total += os.lstat(os.path.join(root, name)).st_size
            except OSError:
                pass
    return total


def uri_to_path(uri: str) -> str:
    """file:///Users/a%20b/x -> /Users/a b/x；远程 URI 原样返回。"""
    if not uri:
        return ""
    if is_remote_uri(uri):
        return uri
    if uri.startswith("file://"):
        return urllib.parse.unquote(uri[len("file://"):])
    return uri


def parse_workspace_json(meta: Path):
    """返回 (kind, target_path)；kind: folder / workspace / unknown"""
    try:
        data = json.loads(meta.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return "bad-meta", ""
    if not isinstance(data, dict):
        return "unknown", ""
    for key, kind in (("folder", "folder"), ("workspace", "workspace"), ("configuration", "workspace")):
        if data.get(key):
            return kind, uri_to_path(str(data[key]))
    return "unknown", ""


def missing_workspace_folders(ws_file: Path) -> list[str]:
    """多根工作区：检查 .code-workspace 内声明的 folder 是否还在。"""
    missing = []
    try:
        data = json.loads(ws_file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return missing
    base = ws_file.parent
    for item in (data.get("folders") or []):
        raw = item.get("path") if isinstance(item, dict) else None
        if not raw:
            continue
        p = Path(raw)
        if not p.is_absolute():
            p = (base / p).resolve()
        if not p.exists():
            missing.append(str(p))
    return missing


def referenced_ids(storage_json: Path) -> set[str]:
    """globalStorage/storage.json 中被引用的 workspace id（正在打开 / 有热退出备份）。"""
    ids: set[str] = set()
    try:
        data = json.loads(storage_json.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return ids

    bw = data.get("backupWorkspaces") or {}
    for item in bw.get("workspaces") or []:
        if isinstance(item, dict) and item.get("id"):
            ids.add(str(item["id"]))
    # 空窗口备份目录：键名是 backupFolder（数字时间戳），对应 workspaceStorage 下的同名目录
    for item in bw.get("emptyWindows") or []:
        if isinstance(item, dict):
            for key in ("backupFolder", "id"):
                if item.get(key):
                    ids.add(str(item[key]))

    ws_state = data.get("windowsState") or {}
    windows = [ws_state.get("lastActiveWindow")] + list(ws_state.get("openedWindows") or [])
    for win in windows:
        if not isinstance(win, dict):
            continue
        bp = win.get("backupPath") or ""
        if bp:
            ids.add(Path(bp).name)
        wid = win.get("workspace", {})
        if isinstance(wid, dict) and wid.get("id"):
            ids.add(str(wid["id"]))
        folder = win.get("folder")
        if folder:
            ids.add(uri_to_path(folder))
    return ids


def app_is_running(app_dir: str) -> bool:
    try:
        out = subprocess.run(
            ["pgrep", "-x", app_dir], capture_output=True, text=True, timeout=5
        )
        return out.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def scan(base: Path, refs: set[str], include_empty: bool, calc_size: bool):
    entries = []
    for child in sorted(base.iterdir()):
        if not child.is_dir():
            continue
        name = child.name
        meta = child / "workspace.json"
        rec = {
            "name": name,
            "path": child,
            "status": "OK",
            "target": "",
            "note": "",
            "size": 0,
            "referenced": name in refs,
        }

        if not meta.exists():
            # 空窗口 / 无元数据目录
            if name in PROTECTED_DIRS or name in refs or not include_empty:
                rec["status"] = "NO_META"
                rec["note"] = "无 workspace.json（空窗口），保留"
                if name in PROTECTED_DIRS:
                    rec["note"] = "受保护目录，跳过"
                elif name in refs:
                    rec["note"] = "无 workspace.json，但被 storage.json 引用"
                rec["size"] = dir_size(child) if calc_size else 0
                entries.append(rec)
                continue
            rec["status"] = "EMPTY_ORPHAN"
            rec["note"] = "无 workspace.json 且无引用"
            rec["size"] = dir_size(child) if calc_size else 0
            entries.append(rec)
            continue

        kind, target = parse_workspace_json(meta)
        rec["target"] = target
        if kind == "bad-meta":
            rec["status"] = "NO_META"
            rec["note"] = "workspace.json 解析失败"
        elif not target:
            rec["status"] = "NO_META"
            rec["note"] = "workspace.json 未声明 folder/workspace"
        elif is_remote_uri(target):
            # 远程工作区（Codespaces/SSH/容器等）：本地无法判断有效性，跳过
            rec["status"] = "REMOTE"
            rec["note"] = "远程工作区，跳过（本地无法校验）"
        elif not os.path.exists(target):
            rec["status"] = "MISSING"
            rec["note"] = "目标路径已不存在"
        else:
            rec["status"] = "OK"
            if kind == "workspace":
                gone = missing_workspace_folders(Path(target))
                if gone:
                    rec["status"] = "PARTIAL"
                    rec["note"] = "工作区文件存在，但缺少子目录: " + ", ".join(gone)

        if rec["name"] in PROTECTED_DIRS:
            rec["status"] = "OK"
            rec["note"] = "受保护目录，跳过"

        if calc_size and rec["status"] not in ("OK", "REMOTE"):
            rec["size"] = dir_size(child)
        entries.append(rec)

    entries.sort(key=lambda r: (STATUS_ORDER.index(r["status"]) if r["status"] in STATUS_ORDER else 99, r["name"]))
    return entries


def delete_entry(rec, use_trash: bool, trash_dir: Path) -> str:
    src: Path = rec["path"]
    if use_trash:
        trash_dir.mkdir(parents=True, exist_ok=True)
        dst = trash_dir / src.name
        if dst.exists():
            dst = trash_dir / f"{src.name}.{os.getpid()}"
        shutil.move(str(src), str(dst))
        return f"trashed -> {dst}"
    if src.is_dir() and not src.is_symlink():
        shutil.rmtree(src)
    else:
        src.unlink()
    return "deleted"


def main() -> int:
    ap = argparse.ArgumentParser(
        description="清理编辑器 workspaceStorage 中的失效工作区缓存",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="默认 dry-run；加 --apply 才真正删除。",
    )
    ap.add_argument("--app", default="cursor", help="cursor|code|windsurf|trae|... 或自定义目录名（默认 cursor）")
    ap.add_argument("--storage-dir", help="直接指定 workspaceStorage 路径（优先于 --app）")
    ap.add_argument("--apply", action="store_true", help="执行删除（默认只报告）")
    ap.add_argument("--trash", action="store_true", help="移动到 ~/.Trash 而非直接删除（可恢复）")
    ap.add_argument("--include-empty", action="store_true", help="同时清理无引用的空窗口存储目录")
    ap.add_argument("--force", action="store_true", help="编辑器正在运行时也强制删除")
    ap.add_argument("--list", action="store_true", help="同时列出全部有效条目")
    ap.add_argument("--no-size", action="store_true", help="不统计目录大小（更快）")
    args = ap.parse_args()

    if args.storage_dir:
        base = Path(args.storage_dir).expanduser()
        # .../<AppName>/User/workspaceStorage -> <AppName>
        app_dir_name = base.parent.parent.name if base.parent.name == "User" else base.name
        app_label = app_dir_name
    else:
        key = args.app.lower()
        app_dir_name = KNOWN_APPS.get(key, args.app)
        app_label = app_dir_name
        base = Path.home() / "Library/Application Support" / app_dir_name / "User/workspaceStorage"

    if not base.is_dir():
        print(f"✗ 目录不存在: {base}", file=sys.stderr)
        return 2

    # <...>/User/workspaceStorage -> <...>/User/globalStorage/storage.json
    storage_json = base.parent / "globalStorage" / "storage.json"
    refs = referenced_ids(storage_json)
    entries = scan(base, refs, args.include_empty, not args.no_size)

    invalid = [e for e in entries if e["status"] in ("MISSING", "PARTIAL", "EMPTY_ORPHAN")]
    # PARTIAL 只提示，不自动删除，避免误删仍在用的多根工作区
    to_delete = [e for e in invalid if e["status"] != "PARTIAL"]
    partial = [e for e in invalid if e["status"] == "PARTIAL"]
    no_meta = [e for e in entries if e["status"] == "NO_META"]
    remote = [e for e in entries if e["status"] == "REMOTE"]
    ok = [e for e in entries if e["status"] == "OK"]

    print(f"应用: {app_label}")
    print(f"路径: {base}")
    print(f"总计: {len(entries)} 个目录 | 有效 {len(ok)} | 失效 {len(to_delete)} | "
          f"部分失效 {len(partial)} | 空窗口/无元数据 {len(no_meta)} | 远程 {len(remote)}")
    print("-" * 78)

    if to_delete:
        print(f"\n[失效 - {'将删除' if args.apply else '待删除'}] {len(to_delete)} 个")
        for e in to_delete:
            size = f"  ({human_size(e['size'])})" if e["size"] else ""
            print(f"  {e['name']}{size}")
            print(f"      -> {e['target'] or e['note']}")

    if partial:
        print(f"\n[部分失效 - 仅提示，不删除] {len(partial)} 个")
        for e in partial:
            print(f"  {e['name']}\n      -> {e['target']}\n      !! {e['note']}")

    if no_meta:
        flag = "（--include-empty 可清理无引用项）" if not args.include_empty else ""
        print(f"\n[空窗口 / 无元数据 - 保留] {len(no_meta)} 个 {flag}")
        for e in no_meta:
            size = f"  ({human_size(e['size'])})" if e["size"] else ""
            print(f"  {e['name']}{size} — {e['note']}")

    if remote:
        print(f"\n[远程工作区 - 跳过] {len(remote)} 个")
        for e in remote:
            print(f"  {e['name']}\n      -> {e['target']}")

    if args.list and ok:
        print(f"\n[有效] {len(ok)} 个")
        for e in ok:
            print(f"  {e['name']}\n      -> {e['target']}")

    if not to_delete:
        print("\n✓ 没有需要清理的失效工作区。")
        return 0

    total = sum(e["size"] for e in to_delete)
    print(f"\n合计可释放: {human_size(total)}")

    if not args.apply:
        argv = [Path(sys.argv[0]).name] + [a for a in sys.argv[1:] if a not in ("--apply", "--trash")]
        print("\n(dry-run) 确认无误后执行: " + " ".join(argv + ["--apply", "--trash"]))
        return 0

    running = app_is_running(app_dir_name)
    if running and not args.force:
        print(f"\n✗ {app_label} 正在运行，为避免状态损坏已中止。\n"
              f"  请先完全退出 {app_label}，或加 --force 强制继续。", file=sys.stderr)
        return 1

    trash_dir = Path.home() / ".Trash"
    freed = 0
    failed = []
    print()
    for e in to_delete:
        try:
            msg = delete_entry(e, args.trash, trash_dir)
            freed += e["size"]
            print(f"  ✓ {msg}: {e['name']}")
        except OSError as exc:
            failed.append((e["name"], str(exc)))
            print(f"  ✗ 失败: {e['name']} — {exc}")

    print(f"\n完成: 处理 {len(to_delete) - len(failed)}/{len(to_delete)} 个，"
          f"释放 {human_size(freed)}" + ("（已移入废纸篓）" if args.trash else ""))
    if failed:
        print("失败项: " + ", ".join(n for n, _ in failed), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\n已取消", file=sys.stderr)
        sys.exit(130)
