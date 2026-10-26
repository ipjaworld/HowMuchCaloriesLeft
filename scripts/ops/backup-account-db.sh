#!/usr/bin/env bash
# Monthly account DB backup — run by the operator, never by the app or CI.
#
#   SUPABASE_DB_URL='postgresql://…pooler.supabase.com:5432/postgres' scripts/ops/backup-account-db.sh
#   scripts/ops/backup-account-db.sh --dry-run      # shows what it would do, connects to nothing
#
# Dumps the account data (public, private, auth.users, auth.identities) as
# data-only SQL, encrypts it with gpg (AES256, passphrase asked by gpg) and
# keeps the newest $BACKUP_KEEP files. Plaintext never touches the disk.
# The repository is public: the output directory may not be inside it.
# See docs/account-backup.md.
set -euo pipefail

KEEP="${BACKUP_KEEP:-3}"
OUT_DIR="${BACKUP_DIR:-$HOME/hetrich-backup/calories}"
DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
mkdir -p "$OUT_DIR"
out_abs="$(cd "$OUT_DIR" && pwd -P)"
case "$out_abs/" in
  "$repo_root"/*) echo "Refusing: $out_abs is inside the repository." >&2; exit 1 ;;
esac
[[ "$KEEP" =~ ^[1-9][0-9]*$ ]] || { echo "BACKUP_KEEP must be a positive integer." >&2; exit 1; }

file="$out_abs/calories-account-$(date -u +%Y%m%dT%H%M%SZ).sql.gpg"
tables=(-t 'public.*' -t 'private.*' -t 'auth.users' -t 'auth.identities')

prune() {
  # Newest first by name (the timestamp sorts); drop everything past $KEEP.
  local old
  old="$(ls -1 "$out_abs"/calories-account-*.sql.gpg 2>/dev/null | sort -r | tail -n +"$((KEEP + 1))")"
  [[ -z "$old" ]] && return 0
  while IFS= read -r path; do
    if [[ "$DRY_RUN" == 1 ]]; then echo "would delete $path"; else rm -f -- "$path"; echo "deleted $path"; fi
  done <<< "$old"
}

if [[ "$DRY_RUN" == 1 ]]; then
  echo "would dump ${tables[*]} (data only) → gpg AES256 → $file"
  echo "keeping newest $KEEP in $out_abs"
  prune
  exit 0
fi

[[ -n "${SUPABASE_DB_URL:-}" ]] || { echo "Set SUPABASE_DB_URL in this shell (Session pooler URL). Never save it in the repository." >&2; exit 1; }
command -v gpg >/dev/null || { echo "gpg not found." >&2; exit 1; }

dump() {
  if command -v pg_dump >/dev/null; then
    pg_dump --data-only --no-owner --no-privileges "${tables[@]}" "$SUPABASE_DB_URL"
  elif command -v docker >/dev/null && docker info >/dev/null 2>&1; then
    docker run --rm -e DATABASE_URL="$SUPABASE_DB_URL" postgres:17 \
      sh -c 'exec pg_dump --data-only --no-owner --no-privileges -t "public.*" -t "private.*" -t auth.users -t auth.identities "$DATABASE_URL"'
  else
    echo "Need pg_dump (PostgreSQL 17 client tools) or a running Docker." >&2
    return 1
  fi
}

tmp="$file.partial"
trap 'rm -f -- "$tmp"' EXIT
dump | gpg --symmetric --cipher-algo AES256 --output "$tmp"
[[ -s "$tmp" ]] || { echo "Backup is empty; nothing kept." >&2; exit 1; }
mv -- "$tmp" "$file"
echo "saved $file ($(wc -c < "$file") bytes)"
prune
