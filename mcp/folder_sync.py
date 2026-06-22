# -*- coding: utf-8 -*-
"""folder_sync.py — 로컬 폴더의 마크다운 체크리스트를 Protask 보드(Supabase)에 거울 동기화.

매핑:  폴더 = 프로젝트(workspaces) ▸ 체크리스트 파일 = 서브프로젝트(projects) ▸ 체크박스 줄 = 태스크(tasks)
방향:  폴더 → 보드 단방향(거울). 동기화 전용 서브프로젝트 안의 태스크만 폴더가 덮어쓴다.
트리거: 각 레포의 git post-commit 훅(register가 자동 설치).

사용:
  python folder_sync.py register <path> [--name N] [--checklist GLOB ...]
  python folder_sync.py sync <path>
  python folder_sync.py sync-all
  python folder_sync.py unregister <path>
  python folder_sync.py list

ENV (mcp/.env 또는 환경변수): SUPABASE_URL, SUPABASE_KEY(service_role)
의존성 없음 — stdlib(urllib)만 사용(어떤 python에서 훅이 돌아도 동작).
"""
import argparse
import glob
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

# Windows 콘솔(cp949)에서도 한글·기호 출력이 깨지거나 크래시하지 않도록 UTF-8 강제.
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
REGISTRY = os.path.join(HERE, "folder_sync.registry.json")
ENV_FILE = os.path.join(HERE, ".env")

GAP = 1024
MARK_START = "<!--folder-sync-->"
MARK_END = "<!--/folder-sync-->"
ITEM_RE = re.compile(r"^\s*[-*]\s+\[([ xX])\]\s+(.+?)\s*$")
H1_RE = re.compile(r"^#\s+(.+?)\s*$")
DEFAULT_CHECKLISTS = ["TODO.md"]


# ───────────────────────── env ─────────────────────────

def _load_env():
    if not os.path.exists(ENV_FILE):
        return
    with open(ENV_FILE, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_env()
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")
REST = f"{SUPABASE_URL}/rest/v1"


def _need_env():
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise SystemExit("SUPABASE_URL/SUPABASE_KEY 미설정 — mcp/.env 를 확인하세요.")


# ───────────────────────── Supabase REST (urllib) ─────────────────────────

def _req(method, path, body=None, prefer=None):
    url = f"{REST}/{path}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read().decode("utf-8")
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        msg = e.read().decode("utf-8", "replace")
        raise RuntimeError(f"{method} {path} -> {e.code}: {msg}") from None


def _get(path):
    return _req("GET", path)


def _upsert(table, rows):
    _req("POST", table, rows, "resolution=merge-duplicates,return=minimal")


def _delete(table, flt):
    _req("DELETE", f"{table}?{flt}", None, "return=minimal")


# ───────────────────────── helpers ─────────────────────────

def _hid(prefix, *parts):
    h = hashlib.sha1("\x1f".join(parts).encode("utf-8")).hexdigest()[:12]
    return f"{prefix}_{h}"


def _now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%S+09:00")


def _norm(s):
    return re.sub(r"\s+", " ", s).strip().lower()


def _load_registry():
    if os.path.exists(REGISTRY):
        with open(REGISTRY, encoding="utf-8") as f:
            return json.load(f)
    return {"folders": []}


def _save_registry(reg):
    with open(REGISTRY, "w", encoding="utf-8") as f:
        json.dump(reg, f, ensure_ascii=False, indent=2)


def _find(reg, path):
    ap = os.path.abspath(path)
    for e in reg["folders"]:
        if os.path.abspath(e["path"]) == ap:
            return e
    return None


# ───────────────────────── git ─────────────────────────

def _git(path, *args):
    try:
        out = subprocess.run(
            ["git", "-C", path, *args],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=15,
        )
        return out.stdout.strip() if out.returncode == 0 else ""
    except Exception:
        return ""


def _git_meta(path):
    last = _git(path, "log", "-1", "--format=%h|%s|%cI")
    branch = _git(path, "rev-parse", "--abbrev-ref", "HEAD")
    count = _git(path, "rev-list", "--count", "HEAD")
    h = s = when = ""
    if last and "|" in last:
        parts = (last.split("|", 2) + ["", "", ""])[:3]
        h, s, when = parts
    return {"hash": h, "subject": s, "when": when, "branch": branch, "count": count}


# ───────────────────────── checklist ─────────────────────────

def _parse_checklist(fp):
    """파일에서 (H1 제목, [{text, done}]) 추출."""
    title = None
    items = []
    with open(fp, encoding="utf-8") as f:
        for line in f:
            if title is None:
                m = H1_RE.match(line)
                if m:
                    title = m.group(1)
            m = ITEM_RE.match(line)
            if m:
                items.append({"text": m.group(2), "done": m.group(1).lower() == "x"})
    return title, items


# ───────────────────────── overview note ─────────────────────────

def _render_block(ap, git, file_summaries, done, total):
    pct = round(done / total * 100) if total else 0
    lines = [
        "## 📁 folder-sync",
        f"- 경로: `{ap}`",
        f"- 진척: {done}/{total} ({pct}%)",
    ]
    if git.get("hash"):
        lines.append(f"- 최근 커밋: `{git['hash']}` {git['subject']} ({git['when']})")
    if git.get("branch"):
        lines.append(f"- 브랜치: {git['branch']} · 총 커밋 {git.get('count', '?')}")
    lines.append(f"- 마지막 동기화: {_now_iso()}")
    if file_summaries:
        lines.append("")
        for t, d, n in file_summaries:
            lines.append(f"  - {t}: {d}/{n}")
    return "\n".join(lines)


def _write_overview(ws_id, ap, git, file_summaries, done, total):
    block = _render_block(ap, git, file_summaries, done, total)
    seg = f"{MARK_START}\n{block}\n{MARK_END}"
    existing = _get(f"workspace_canvas?workspace_id=eq.{ws_id}&select=notes")
    old = (existing[0]["notes"] if existing else "") or ""
    if MARK_START in old and MARK_END in old:
        new = re.sub(re.escape(MARK_START) + r".*?" + re.escape(MARK_END), lambda _m: seg, old, flags=re.S)
    elif old.strip():
        new = old.rstrip() + "\n\n" + seg
    else:
        new = seg
    # notes만 보내면 기존 scene(엑스칼리드로우)은 보존된다(merge-duplicates는 제공 컬럼만 갱신).
    _upsert("workspace_canvas", [{"workspace_id": ws_id, "notes": new}])


# ───────────────────────── sync ─────────────────────────

def sync(path, name=None, checklists=None):
    _need_env()
    ap = os.path.abspath(path)
    if not os.path.isdir(ap):
        raise SystemExit(f"폴더 없음: {ap}")

    ws_id = _hid("ws", ap)
    ws_name = name or os.path.basename(ap.rstrip("\\/")) or ap
    _upsert("workspaces", [{"id": ws_id, "name": ws_name}])

    globs = checklists or DEFAULT_CHECKLISTS
    files = []
    for g in globs:
        for fp in glob.glob(os.path.join(ap, g), recursive=True):
            if os.path.isfile(fp):
                files.append(fp)
    files = sorted(set(files))

    total_items = total_done = 0
    file_summaries = []

    for fp in files:
        rel = os.path.relpath(fp, ap).replace("\\", "/")
        title, items = _parse_checklist(fp)
        pr_id = _hid("pr", ap, rel)
        pr_title = title or rel
        # status는 보내지 않음 → 신규는 기본 'active', 보드에서 수동 변경한 상태는 보존.
        _upsert("projects", [{"id": pr_id, "workspace_id": ws_id, "title": pr_title}])

        existing = _get(f"tasks?project_id=eq.{pr_id}&select=id,status,completed_at") or []
        existing_map = {t["id"]: t for t in existing}

        seen = {}
        rows = []
        cur_ids = set()
        for idx, it in enumerate(items):
            key = _norm(it["text"])
            seen[key] = seen.get(key, 0) + 1
            tid = _hid("t", pr_id, key, str(seen[key]))
            cur_ids.add(tid)
            prev = existing_map.get(tid)
            if it["done"]:
                completed = prev["completed_at"] if (prev and prev.get("status") == "done" and prev.get("completed_at")) else _now_iso()
            else:
                completed = None
            rows.append({
                "id": tid, "workspace_id": ws_id, "project_id": pr_id,
                "title": it["text"], "status": "done" if it["done"] else "todo",
                "position": (idx + 1) * GAP, "completed_at": completed,
            })
        if rows:
            _upsert("tasks", rows)
        # 거울: 파일에서 사라진 줄 = 보드에서 삭제(동기화 전용 서브프로젝트 한정)
        for tid in existing_map:
            if tid not in cur_ids:
                _delete("tasks", f"id=eq.{tid}")

        d = sum(1 for it in items if it["done"])
        total_items += len(items)
        total_done += d
        file_summaries.append((pr_title, d, len(items)))

    _write_overview(ws_id, ap, _git_meta(ap), file_summaries, total_done, total_items)
    return ws_id, total_done, total_items, len(files)


# ───────────────────────── git hook ─────────────────────────

MARKER = "# folder-sync (Protask)"


def _install_hook(path):
    ap = os.path.abspath(path)
    git_dir = os.path.join(ap, ".git")
    if not os.path.isdir(git_dir):
        print(f"  ⚠ git 레포 아님 — post-commit 훅 건너뜀: {ap}")
        return
    hooks_dir = os.path.join(git_dir, "hooks")
    os.makedirs(hooks_dir, exist_ok=True)
    hook_path = os.path.join(hooks_dir, "post-commit")
    script_fwd = os.path.join(HERE, "folder_sync.py").replace("\\", "/")
    repo_fwd = ap.replace("\\", "/")
    line = f'python "{script_fwd}" sync "{repo_fwd}" >> "{repo_fwd}/.git/folder_sync.log" 2>&1 || true'

    if os.path.exists(hook_path):
        with open(hook_path, encoding="utf-8") as f:
            content = f.read()
        if MARKER in content:
            print("  · post-commit 훅 이미 설치됨")
            return
        with open(hook_path, "a", encoding="utf-8", newline="\n") as f:
            f.write(f"\n{MARKER}\n{line}\n")
        print("  + 기존 post-commit 훅에 folder-sync 추가")
    else:
        with open(hook_path, "w", encoding="utf-8", newline="\n") as f:
            f.write(f"#!/bin/sh\n{MARKER}\n{line}\n")
        print("  + post-commit 훅 생성")
    try:
        os.chmod(hook_path, 0o755)
    except Exception:
        pass


# ───────────────────────── commands ─────────────────────────

def cmd_register(args):
    ap = os.path.abspath(args.path)
    reg = _load_registry()
    entry = _find(reg, ap)
    checklists = args.checklist or DEFAULT_CHECKLISTS
    if entry:
        if args.name:
            entry["name"] = args.name
        entry["checklists"] = checklists
        print(f"· 이미 등록됨 — 설정 갱신: {ap}")
    else:
        entry = {"path": ap, "name": args.name, "checklists": checklists}
        reg["folders"].append(entry)
        print(f"+ 등록: {ap}")
    _save_registry(reg)
    _install_hook(ap)
    ws_id, done, total, nfiles = sync(ap, entry.get("name"), checklists)
    print(f"  ✓ 동기화 완료: 프로젝트 {ws_id} · 파일 {nfiles} · 태스크 {done}/{total}")


def cmd_sync(args):
    reg = _load_registry()
    entry = _find(reg, args.path) or {}
    ws_id, done, total, nfiles = sync(args.path, entry.get("name"), entry.get("checklists"))
    print(f"✓ {os.path.abspath(args.path)}: 태스크 {done}/{total} (파일 {nfiles})")


def cmd_sync_all(args):
    reg = _load_registry()
    if not reg["folders"]:
        print("등록된 폴더 없음")
        return
    for e in reg["folders"]:
        try:
            _, done, total, nfiles = sync(e["path"], e.get("name"), e.get("checklists"))
            print(f"✓ {e['path']}: {done}/{total} (파일 {nfiles})")
        except Exception as ex:
            print(f"✗ {e['path']}: {ex}")


def cmd_unregister(args):
    ap = os.path.abspath(args.path)
    reg = _load_registry()
    before = len(reg["folders"])
    reg["folders"] = [e for e in reg["folders"] if os.path.abspath(e["path"]) != ap]
    _save_registry(reg)
    print(f"{'− 등록 해제' if len(reg['folders']) < before else '· 등록 내역 없음'}: {ap}")
    print("  (post-commit 훅은 수동 제거: .git/hooks/post-commit 의 folder-sync 줄)")


def cmd_list(args):
    reg = _load_registry()
    if not reg["folders"]:
        print("등록된 폴더 없음")
        return
    for e in reg["folders"]:
        name = e.get("name") or os.path.basename(e["path"])
        cl = e.get("checklists") or DEFAULT_CHECKLISTS
        print(f"- {e['path']}  (name={name}, checklists={cl})")


def main():
    p = argparse.ArgumentParser(prog="folder_sync", description="로컬 폴더 ↔ Protask 보드 거울 동기화")
    sub = p.add_subparsers(dest="cmd", required=True)

    pr = sub.add_parser("register", help="폴더 등록 + post-commit 훅 설치 + 초기 동기화")
    pr.add_argument("path")
    pr.add_argument("--name", help="프로젝트 표시 이름(기본: 폴더명)")
    pr.add_argument("--checklist", action="append", help="체크리스트 글롭(반복 가능, 기본 TODO.md)")
    pr.set_defaults(func=cmd_register)

    ps = sub.add_parser("sync", help="폴더 1개 동기화(훅이 호출)")
    ps.add_argument("path")
    ps.set_defaults(func=cmd_sync)

    sub.add_parser("sync-all", help="등록된 전 폴더 동기화").set_defaults(func=cmd_sync_all)

    pu = sub.add_parser("unregister", help="등록 해제")
    pu.add_argument("path")
    pu.set_defaults(func=cmd_unregister)

    sub.add_parser("list", help="등록 목록").set_defaults(func=cmd_list)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
