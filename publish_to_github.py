#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
publish_to_github.py - puts this project on GitHub for you, with almost no work.

What it does (you only sign in to GitHub in your browser):
  1. checks / installs Git and the GitHub CLI (with winget on Windows)
  2. signs you in to GitHub in your browser (a one-time code, no password typed here)
  3. fills your GitHub name into the README, LICENSE and installer
  4. scans the files so no token or personal value is uploaded by mistake
  5. creates the repository and uploads everything

Run:   python publish_to_github.py
Safe to run again later: it uploads only what changed.

Options:
  --name NAME     repository name (default: schedule-bot)
  --private       make the repository private (default: public)
  --yes           do not ask questions, use the defaults
  --dry-run       check everything, change nothing, upload nothing
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DEFAULT_NAME = "schedule-bot"
DEFAULT_DESCRIPTION = "Telegram bot + Mini App for class reminders, habits and study tracking. Runs free on Cloudflare Workers."
TOPICS = ["telegram-bot", "telegram-mini-app", "cloudflare-workers", "cloudflare-d1", "durable-objects",
          "typescript", "reminder", "schedule", "persian"]
PLACEHOLDER_FILES = ["README.md", "README.fa.md", "LICENSE", "install.ps1", "update.ps1"]

# Things that must never be uploaded.
SECRET_PATTERNS = [
    ("a Telegram bot token", re.compile(r"\b\d{8,10}:[A-Za-z0-9_-]{35}\b")),
    ("a GitHub token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{36,}\b")),
    ("a private key", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----")),
    ("a Cloudflare API token", re.compile(r"CLOUDFLARE_API_TOKEN\s*[=:]\s*[\"']?[A-Za-z0-9_-]{20,}")),
]

IS_WINDOWS = os.name == "nt"


# ----------------------------------------------------------------------------- screen helpers
def setup_console():
    if IS_WINDOWS:
        os.system("chcp 65001 >nul")  # UTF-8 so the Persian text shows
        os.system("")                  # turns on colors in the Windows console
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


def color(text, code):
    return f"\033[{code}m{text}\033[0m" if sys.stdout.isatty() else text


def say(text=""):
    print(text)


def step(n, text):
    print()
    print(color(f"[{n}] {text}", "36;1"))


def ok(text):
    print(color(f"    ✔ {text}", "32"))


def warn(text):
    print(color(f"    ! {text}", "33"))


def info(text):
    print(f"    {text}")


def die(text, code=1):
    print()
    print(color(f"✖ {text}", "31;1"))
    print(color("  مشکل رو برطرف کن و دوباره اجرا کن. اجرای دوباره بی‌خطره.", "33"))
    pause_at_end()
    sys.exit(code)


def pause_at_end():
    if sys.stdin and sys.stdin.isatty() and IS_WINDOWS:
        try:
            input("\nبرای بستن Enter بزن...")
        except EOFError:
            pass


def ask(question, default="", assume_yes=False):
    if assume_yes:
        return default
    suffix = f" [{default}]" if default else ""
    try:
        answer = input(f"    {question}{suffix}: ").strip()
    except EOFError:
        answer = ""
    return answer or default


def ask_yes_no(question, default=True, assume_yes=False):
    if assume_yes:
        return default
    hint = "Y/n" if default else "y/N"
    try:
        answer = input(f"    {question} [{hint}]: ").strip().lower()
    except EOFError:
        answer = ""
    if not answer:
        return default
    return answer in ("y", "yes", "ب", "بله")


# ----------------------------------------------------------------------------- running programs
def run(args, capture=True, check=False, cwd=None, input_text=None):
    """Run a program. With capture=False the person sees its output (and can answer its questions)."""
    try:
        return subprocess.run(
            args, cwd=str(cwd or ROOT), text=True, encoding="utf-8", errors="replace",
            capture_output=capture, check=check, input=input_text,
        )
    except FileNotFoundError:
        die(f"برنامه‌ی «{args[0]}» پیدا نشد.")


def refresh_path_from_registry():
    """After winget installs something, the current window does not know yet. Reload PATH from Windows."""
    if not IS_WINDOWS:
        return
    try:
        import winreg
        parts = []
        for hive, sub in ((winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment"),
                          (winreg.HKEY_CURRENT_USER, "Environment")):
            try:
                with winreg.OpenKey(hive, sub) as key:
                    value, _ = winreg.QueryValueEx(key, "Path")
                    parts.append(os.path.expandvars(value))
            except OSError:
                pass
        if parts:
            os.environ["PATH"] = ";".join(parts)
    except Exception:
        pass


def find_tool(name, extra):
    found = shutil.which(name)
    if found:
        return found
    for candidate in extra:
        path = os.path.expandvars(candidate)
        if os.path.isfile(path):
            return path
    return None


GIT_PATHS = [r"%ProgramFiles%\Git\cmd\git.exe", r"%ProgramFiles(x86)%\Git\cmd\git.exe", r"%LOCALAPPDATA%\Programs\Git\cmd\git.exe"]
GH_PATHS = [r"%ProgramFiles%\GitHub CLI\gh.exe", r"%ProgramFiles(x86)%\GitHub CLI\gh.exe", r"%LOCALAPPDATA%\Programs\GitHub CLI\gh.exe"]


def ensure_tool(name, paths, winget_id, label, url, assume_yes):
    tool = find_tool(name, paths if IS_WINDOWS else [])
    if tool:
        return tool
    warn(f"{label} نصب نیست.")
    if IS_WINDOWS and shutil.which("winget"):
        if ask_yes_no(f"{label} الان خودکار نصب بشه؟", True, assume_yes):
            run(["winget", "install", "--id", winget_id, "-e", "--accept-package-agreements", "--accept-source-agreements"], capture=False)
            refresh_path_from_registry()
            tool = find_tool(name, paths)
            if tool:
                return tool
            die(f"نصب انجام شد ولی این پنجره هنوز {label} رو نمی‌شناسه. این پنجره رو ببند، یه PowerShell تازه باز کن و دوباره اجرا کن.")
    die(f"{label} رو از این آدرس نصب کن و دوباره اجرا کن: {url}")


# ----------------------------------------------------------------------------- the steps
def check_project():
    if not (ROOT / "src" / "index.ts").exists() or not (ROOT / "package.json").exists():
        die("این فایل باید داخل پوشه‌ی پروژه (کنار package.json) باشه.")
    ok(f"پروژه پیدا شد: {ROOT}")


def gh_logged_in(gh):
    return run([gh, "auth", "status", "--hostname", "github.com"]).returncode == 0


def ensure_login(gh, dry):
    if dry:
        info("(dry-run) ورود به GitHub رد شد.")
        return
    if not gh_logged_in(gh):
        say()
        info("الان یه کد یک‌بارمصرف (مثل ABCD-1234) نشون داده می‌شه.")
        info("۱) کد رو کپی کن  ۲) Enter بزن تا مرورگر باز بشه  ۳) کد رو بچسبون و Authorize رو بزن.")
        say()
        code = run([gh, "auth", "login", "--hostname", "github.com", "--git-protocol", "https", "--web",
                    "--scopes", "repo,workflow"], capture=False).returncode
        if code != 0 or not gh_logged_in(gh):
            die("ورود به GitHub کامل نشد.")
    status = run([gh, "auth", "status", "--hostname", "github.com"])
    if "workflow" not in (status.stdout + status.stderr):
        info("یه مجوز کوچیک دیگه لازمه (برای فایل‌های CI). دوباره مرورگر باز می‌شه.")
        run([gh, "auth", "refresh", "--hostname", "github.com", "--scopes", "workflow"], capture=False)
    run([gh, "auth", "setup-git"])  # lets plain `git push` use the same login
    ok("وارد GitHub هستی")


def get_github_user(gh, dry):
    if dry:
        return {"login": "YOUR-USERNAME", "name": "Your Name", "id": 0, "email": None}
    result = run([gh, "api", "user"])
    if result.returncode != 0:
        die("اطلاعات حساب GitHub خونده نشد: " + (result.stderr or result.stdout).strip())
    return json.loads(result.stdout)


def apply_placeholders(user, repo, dry):
    values = {
        "{{GITHUB_USER}}": user["login"],
        "{{REPO}}": repo,
        "{{AUTHOR}}": (user.get("name") or user["login"]).strip(),
        "{{YEAR}}": str(date.today().year),
    }
    changed = []
    for name in PLACEHOLDER_FILES:
        path = ROOT / name
        if not path.exists():
            continue
        with open(path, "r", encoding="utf-8", newline="") as handle:
            text = handle.read()
        new = text
        for key, value in values.items():
            new = new.replace(key, value)
        if new != text:
            changed.append(name)
            if not dry:
                with open(path, "w", encoding="utf-8", newline="") as handle:
                    handle.write(new)
    if changed:
        ok(("(dry-run) این فایل‌ها پر می‌شدن: " if dry else "اسم تو توی این فایل‌ها نوشته شد: ") + ", ".join(changed))
    else:
        ok("اسم تو از قبل توی فایل‌ها هست")


SKIP_DIRS = {".git", "node_modules", ".wrangler", "__pycache__"}
NEVER_UPLOADED = {"wrangler.toml", ".dev.vars", ".env"}


def list_candidate_files(git):
    """Every file that would be uploaded."""
    if (ROOT / ".git").exists():
        result = run([git, "ls-files", "-co", "--exclude-standard"])
        if result.returncode == 0:
            return [line for line in result.stdout.splitlines() if line.strip()]
    # No git repository yet (dry-run): walk the folder ourselves.
    found = []
    for folder, dirs, names in os.walk(ROOT):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for name in names:
            if name in NEVER_UPLOADED:
                continue
            found.append(os.path.relpath(os.path.join(folder, name), ROOT).replace("\\", "/"))
    return found


def local_personal_values():
    """Values from YOUR wrangler.toml that must never appear in a file that gets uploaded."""
    path = ROOT / "wrangler.toml"
    values = []
    if path.exists():
        text = path.read_text(encoding="utf-8", errors="replace")
        m = re.search(r'database_id\s*=\s*"([0-9a-fA-F-]{36})"', text)
        if m:
            values.append(m.group(1))
        for host in re.findall(r"https://([A-Za-z0-9-]+\.[A-Za-z0-9-]+\.workers\.dev)", text):
            if "YOUR-NAME" not in host and "yourname" not in host:
                values.append(host)
    return values


def safety_scan(git):
    problems = []
    ignored = run([git, "check-ignore", "wrangler.toml"]) if (ROOT / ".git").exists() else None
    gitignore = (ROOT / ".gitignore").read_text(encoding="utf-8", errors="replace") if (ROOT / ".gitignore").exists() else ""
    protected = (ignored is not None and ignored.returncode == 0) or (ignored is None and re.search(r"^wrangler\.toml\s*$", gitignore, re.M))
    if (ROOT / "wrangler.toml").exists() and not protected:
        problems.append("wrangler.toml در .gitignore نیست (شناسه‌ی دیتابیس شخصی تو توشه).")
    personal = local_personal_values()
    files = list_candidate_files(git)
    for rel in files:
        path = ROOT / rel
        if not path.is_file() or path.stat().st_size > 2_000_000:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        for label, pattern in SECRET_PATTERNS:
            if pattern.search(text):
                problems.append(f"{rel}: به نظر می‌رسه {label} داخلشه.")
        for value in personal:
            if value in text:
                problems.append(f"{rel}: مقدار شخصی «{value}» داخلشه.")
    if problems:
        print()
        for p in problems:
            warn(p)
        die("چیزی که نباید آپلود بشه پیدا شد. چیزی آپلود نشد.")
    ok(f"{len(files)} فایل بررسی شد؛ رمز یا مقدار شخصی پیدا نشد")
    return files


def ensure_git_repo(git, user, dry):
    if not (ROOT / ".git").exists():
        if dry:
            info("(dry-run) git init انجام می‌شد.")
            return
        if run([git, "init", "-b", "main"]).returncode != 0:
            run([git, "init"])
            run([git, "checkout", "-b", "main"])
        ok("مخزن git ساخته شد")
    else:
        run([git, "branch", "-M", "main"])
    if dry:
        return
    if not run([git, "config", "user.name"]).stdout.strip():
        run([git, "config", "user.name", user.get("name") or user["login"]])
    if not run([git, "config", "user.email"]).stdout.strip():
        email = user.get("email") or f"{user['id']}+{user['login']}@users.noreply.github.com"
        run([git, "config", "user.email", email])


def commit_all(git, message, dry):
    if dry:
        info("(dry-run) commit انجام می‌شد.")
        return
    run([git, "add", "-A"])
    if not run([git, "status", "--porcelain"]).stdout.strip():
        ok("چیز جدیدی برای ذخیره نیست")
        return
    result = run([git, "commit", "-m", message])
    if result.returncode != 0:
        die("commit انجام نشد: " + (result.stderr or result.stdout).strip())
    ok("تغییرها ذخیره شد (commit)")


def has_commits(git):
    return run([git, "rev-parse", "--verify", "HEAD"]).returncode == 0


def repo_exists(gh, full):
    return run([gh, "repo", "view", full]).returncode == 0


def publish(gh, git, full, private, description, assume_yes, dry):
    if dry:
        info(f"(dry-run) مخزن {full} ساخته و آپلود می‌شد.")
        return
    exists = repo_exists(gh, full)
    remotes = run([git, "remote"]).stdout.split()
    if not exists:
        if "origin" in remotes:
            run([git, "remote", "remove", "origin"])
        result = run([gh, "repo", "create", full, "--private" if private else "--public",
                      "--description", description, "--source", ".", "--remote", "origin", "--push"], capture=False)
        if result.returncode != 0:
            die("ساخت مخزن در GitHub انجام نشد.")
        ok("مخزن ساخته و همه‌چیز آپلود شد")
    else:
        url = f"https://github.com/{full}.git"
        if "origin" not in remotes:
            run([git, "remote", "add", "origin", url])
        else:
            run([git, "remote", "set-url", "origin", url])
        result = run([git, "push", "-u", "origin", "main"], capture=False)
        if result.returncode != 0:
            warn("روی GitHub از قبل چیزهای دیگه‌ای هست که با این پروژه فرق داره.")
            if ask_yes_no("محتوای اون جا با این پروژه جایگزین بشه؟ (قابل برگشت نیست)", False, assume_yes):
                result = run([git, "push", "-u", "origin", "main", "--force"], capture=False)
            if result.returncode != 0:
                die("آپلود انجام نشد.")
        ok("آپلود شد")
    args = [gh, "repo", "edit", full]
    for topic in TOPICS:
        args += ["--add-topic", topic]
    run(args)  # nice to have; ignore errors


def finish(user, repo):
    url = f"https://github.com/{user['login']}/{repo}"
    say()
    say(color("  تمام شد! 🎉", "32;1"))
    say(f"  صفحه‌ی پروژه:  {url}")
    say()
    say("  هر کسی با این یه خط توی PowerShell می‌تونه ربات رو برای خودش نصب کنه:")
    say(color(f"  irm https://raw.githubusercontent.com/{user['login']}/{repo}/main/install.ps1 | iex", "36"))
    say()
    say("  کارهای اختیاری بعدی:")
    say(f"   • عکس واقعی برنامه: توی ریپو پوشه‌ی docs/images رو ببین و عکس‌هات رو اضافه کن")
    say(f"   • عکس شبکه‌های اجتماعی: {url}/settings  ← Social preview")
    say(f"   • ببین CI سبز شده: {url}/actions")
    try:
        import webbrowser
        webbrowser.open(url)
    except Exception:
        pass


# ----------------------------------------------------------------------------- main
def main():
    setup_console()
    parser = argparse.ArgumentParser(description="Publish this project to GitHub.")
    parser.add_argument("--name", default=None, help="repository name")
    parser.add_argument("--private", action="store_true", help="make the repository private")
    parser.add_argument("--yes", action="store_true", help="use the defaults, ask nothing")
    parser.add_argument("--dry-run", action="store_true", help="check only, change nothing")
    args = parser.parse_args()
    dry = args.dry_run

    say()
    say(color("  آپلود پروژه روی GitHub", "1"))
    say(color("  فقط یک بار توی مرورگر وارد GitHub می‌شی؛ بقیه‌ی کارها خودکاره.", "90"))
    if dry:
        warn("حالت آزمایشی (dry-run): هیچ چیزی تغییر نمی‌کنه و آپلود نمی‌شه.")

    step("1/6", "بررسی پروژه")
    check_project()

    step("2/6", "بررسی Git و GitHub CLI")
    git = ensure_tool("git", GIT_PATHS, "Git.Git", "Git", "https://git-scm.com/download/win", args.yes)
    gh = ensure_tool("gh", GH_PATHS, "GitHub.cli", "GitHub CLI", "https://cli.github.com", args.yes)
    ok("هر دو آماده‌ان")

    step("3/6", "ورود به GitHub")
    ensure_login(gh, dry)
    user = get_github_user(gh, dry)
    ok(f"حساب: {user['login']}")

    step("4/6", "انتخاب اسم و نوع مخزن")
    repo = args.name or ask("اسم مخزن", DEFAULT_NAME, args.yes)
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,100}", repo):
        die("اسم مخزن فقط می‌تونه حرف انگلیسی، عدد، نقطه، خط تیره و زیرخط باشه.")
    private = args.private
    if not args.private and not args.yes:
        private = not ask_yes_no("مخزن عمومی (Public) باشه تا بقیه هم بتونن ازش استفاده کنن؟", True)
    description = DEFAULT_DESCRIPTION
    ok(f"{user['login']}/{repo}  ({'خصوصی' if private else 'عمومی'})")

    step("5/6", "آماده‌سازی و بررسی ایمنی فایل‌ها")
    apply_placeholders(user, repo, dry)
    ensure_git_repo(git, user, dry)
    safety_scan(git)
    first = not has_commits(git) if (ROOT / ".git").exists() else True
    message = "Initial commit" if first else ask("پیام این تغییر (کوتاه)", "Update", args.yes)
    commit_all(git, message, dry)

    step("6/6", "ساخت مخزن و آپلود")
    publish(gh, git, f"{user['login']}/{repo}", private, description, args.yes, dry)

    if not dry:
        finish(user, repo)
    pause_at_end()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nلغو شد.")
        sys.exit(130)
