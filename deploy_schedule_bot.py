#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Schedule Bot: one-command update.

Every time you run it, it does (and stops at the first problem):
  1) checks the project folder
  2) installs npm packages if node_modules is missing
  3) makes a ZIP backup (without secrets / node_modules)
  4) npm run typecheck
  5) npm run db:migrate   (applies NEW migrations to the real D1 database)
  6) npm run deploy       (publishes the bot + Mini App to Cloudflare)

Steps 5 and 6 change the real server, so it asks "y/n" first (use --yes to skip the questions).
It does not touch secrets and never prints them.

Examples:
  python deploy_schedule_bot.py
  python deploy_schedule_bot.py --yes
  python deploy_schedule_bot.py --dry-run
"""

from __future__ import annotations

import argparse
import datetime as dt
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

DEFAULT_PROJECT = r"E:\schedule-bot"

EXCLUDE_DIRS = {".git", "node_modules", ".wrangler", ".venv", "venv", "__pycache__", "dist", "build"}
SECRET_NAMES = {".env", ".dev.vars", ".env.local", ".env.production", "secrets.json"}
SECRET_SUFFIXES = {".pem", ".key", ".p12", ".pfx"}


def say(text: str = "") -> None:
    print(text, flush=True)


def title(text: str) -> None:
    say()
    say("=" * 64)
    say(text)
    say("=" * 64)


def is_secret(path: Path) -> bool:
    name = path.name.lower()
    return name in SECRET_NAMES or name.startswith(".env.") or path.suffix.lower() in SECRET_SUFFIXES or "secret" in name


def make_backup(project: Path, folder: Path) -> Path | None:
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / f"{project.name}-backup-{dt.datetime.now():%Y%m%d-%H%M%S}.zip"
    count = 0
    try:
        with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as zf:
            for root, dirs, files in os.walk(project):
                dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
                for name in files:
                    full = Path(root) / name
                    if is_secret(full):
                        continue
                    zf.write(full, arcname=str(Path(project.name) / full.relative_to(project)))
                    count += 1
    except OSError as exc:
        say(f"[خطا] پشتیبان ساخته نشد: {exc}")
        target.unlink(missing_ok=True)
        return None
    if count == 0:
        target.unlink(missing_ok=True)
        return None
    return target


def run(command: list[str], cwd: Path, dry: bool) -> int:
    """Run a command with its output shown live. Returns the exit code (or -1 if it could not start)."""
    say("> " + " ".join(command))
    if dry:
        say("  (dry-run: اجرا نشد)")
        return 0
    try:
        return subprocess.run(command, cwd=str(cwd), shell=False).returncode
    except FileNotFoundError:
        say("[خطا] این فرمان پیدا نشد. Node.js نصب است؟")
        return -1
    except KeyboardInterrupt:
        say("\n[لغو] با Ctrl+C متوقف شد.")
        return -1


def ask(question: str, assume_yes: bool) -> bool:
    if assume_yes:
        say(f"{question} → بله (--yes)")
        return True
    try:
        return input(f"{question} [y/n]: ").strip().lower() in {"y", "yes", "ب", "بله"}
    except (EOFError, KeyboardInterrupt):
        say()
        return False


def stop(message: str, code: int = 1) -> int:
    say()
    say(f"[توقف] {message}")
    say("هیچ مرحله‌ی بعدی اجرا نشد.")
    return code


def main() -> int:
    ap = argparse.ArgumentParser(description="آپدیت و استقرار Schedule Bot با یک دستور")
    ap.add_argument("--project", default=DEFAULT_PROJECT, help="مسیر پوشه‌ی پروژه")
    ap.add_argument("--backup-dir", default="", help="مسیر ذخیره‌ی پشتیبان (پیش‌فرض: Desktop)")
    ap.add_argument("--yes", action="store_true", help="بدون پرسیدن، migrate و deploy را اجرا کن")
    ap.add_argument("--skip-backup", action="store_true", help="پشتیبان نگیر")
    ap.add_argument("--no-migrate", action="store_true", help="migration اجرا نشود")
    ap.add_argument("--no-deploy", action="store_true", help="deploy اجرا نشود")
    ap.add_argument("--dry-run", action="store_true", help="فقط نشان بده چه می‌کرد، چیزی اجرا نشود")
    args = ap.parse_args()

    project = Path(args.project).expanduser().resolve()
    dry = args.dry_run
    results: list[tuple[str, str]] = []

    title("۱) بررسی پروژه")
    for needed in ("package.json", "wrangler.toml", "src", "migrations"):
        ok = (project / needed).exists()
        say(f"[{'OK' if ok else 'پیدا نشد'}] {needed}")
        if not ok:
            return stop(f"«{needed}» در {project} نیست. مسیر درست را با --project بدهید.", 2)
    results.append(("بررسی پروژه", "OK"))

    npm = shutil.which("npm")
    if not npm:
        return stop("npm پیدا نشد. Node.js را نصب کنید (nodejs.org) و PowerShell را دوباره باز کنید.", 2)

    title("۲) وابستگی‌ها")
    if (project / "node_modules").is_dir():
        say("node_modules هست؛ نصب لازم نیست.")
        results.append(("وابستگی‌ها", "OK"))
    else:
        say("node_modules نیست؛ npm install اجرا می‌شود.")
        if run([npm, "install"], project, dry) != 0:
            return stop("npm install خطا داد.")
        results.append(("npm install", "OK"))

    title("۳) پشتیبان")
    if args.skip_backup or dry:
        say("رد شد." if args.skip_backup else "(dry-run: ساخته نشد)")
        results.append(("پشتیبان", "رد شد"))
    else:
        folder = Path(args.backup_dir).expanduser().resolve() if args.backup_dir else Path.home() / "Desktop"
        backup = make_backup(project, folder)
        if not backup:
            if not ask("پشتیبان ساخته نشد. بدون آن ادامه بدهم؟", args.yes):
                return stop("به خاطر نبودن پشتیبان متوقف شد.")
            results.append(("پشتیبان", "ساخته نشد"))
        else:
            say(f"[OK] {backup}")
            results.append(("پشتیبان", str(backup)))

    title("۴) بررسی کد (typecheck)")
    if run([npm, "run", "typecheck"], project, dry) != 0:
        return stop("typecheck خطا دارد؛ چیزی روی سرور اعمال نشد. خطا را بخوانید و درست کنید.")
    results.append(("typecheck", "OK"))

    title("۵) Migration روی دیتابیس واقعی")
    if args.no_migrate:
        say("رد شد (--no-migrate).")
        results.append(("migrate", "رد شد"))
    elif not ask("migrationهای جدید روی دیتابیس واقعی اعمال شوند؟", args.yes):
        return stop("شما migrate را تایید نکردید.", 0)
    else:
        if run([npm, "run", "db:migrate"], project, dry) != 0:
            return stop("db:migrate خطا داد. بدون migrate deploy نکنید؛ خطا را بفرستید تا بررسی کنیم.")
        results.append(("migrate", "OK"))

    title("۶) Deploy روی Cloudflare")
    if args.no_deploy:
        say("رد شد (--no-deploy).")
        results.append(("deploy", "رد شد"))
    elif not ask("ربات و مینی‌اپ منتشر شوند؟", args.yes):
        return stop("شما deploy را تایید نکردید.", 0)
    else:
        if run([npm, "run", "deploy"], project, dry) != 0:
            return stop("deploy خطا داد.")
        results.append(("deploy", "OK"))

    title("خلاصه")
    for name, state in results:
        say(f"  {name}: {state}")
    say()
    say("تمام شد. در تلگرام /start بزنید و مینی‌اپ را یک بار کامل ببندید و دوباره باز کنید.")
    if dry:
        say("(این اجرا dry-run بود؛ هیچ چیزی واقعاً اجرا نشد.)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
