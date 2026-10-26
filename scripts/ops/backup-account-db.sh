#!/usr/bin/env bash
# Monthly account DB backup — run by the operator, never by the app or CI.
#
#   SUPABASE_DB_URL='postgresql://…pooler.supabase.com:5432/postgres' scripts/ops/backup-account-db.sh
#   scripts/ops/backup-account-db.sh --dry-run      # shows what it would do, connects to nothing
#
# Dumps the account data (public, private, auth.users, auth.identities) as
# data-only SQL, encrypts it with gpg (AES256, passphrase asked by gpg) and
# keeps at most 3 files younger than 90 days. Plaintext never touches the disk.
# The repository is public: the output directory may not be inside it.
# See docs/account-backup.md.
set -euo pipefail

KEEP="${BACKUP_KEEP:-3}"
OUT_DIR="${BACKUP_DIR:-$HOME/hetrich-backup/calories}"
DRY_RUN=0
PRUNE_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --prune-only) PRUNE_ONLY=1 ;;
    *) echo "Usage: $0 [--dry-run] [--prune-only]" >&2; exit 1 ;;
  esac
done
[[ "$KEEP" =~ ^[1-3]$ ]] || { echo "BACKUP_KEEP must be 1, 2 or 3 (published retention policy)." >&2; exit 1; }

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
# Resolve existing ancestors before creating anything, including for dry runs.
out_abs="$(realpath -m "$OUT_DIR")"
repo_compare="${repo_root,,}"
out_compare="${out_abs,,}"
case "$out_compare/" in
  "$repo_compare"/*) echo "Refusing: $out_abs is inside the repository." >&2; exit 1 ;;
esac
if [[ ! -d "$OUT_DIR" ]]; then
  if [[ "$DRY_RUN" == 1 || "$PRUNE_ONLY" == 1 ]]; then
    echo "No backup directory; nothing to prune: $out_abs"
    exit 0
  fi
  mkdir -p "$OUT_DIR"
fi
out_abs="$(cd "$OUT_DIR" && pwd -P)"
case "${out_abs,,}/" in
  "$repo_compare"/*) echo "Refusing: $out_abs is inside the repository." >&2; exit 1 ;;
esac

file="$out_abs/calories-account-$(date -u +%Y%m%dT%H%M%SZ).sql.gpg"
tables=(-t 'public.*' -t 'private.*' -t 'auth.users' -t 'auth.identities')

prune() {
  # Filename time is preserved when copying files; mtime is not a retention clock.
  local path name stamp cutoff kept=0
  # Daily cleanup at 89 days leaves a 24h margin before the published 90 days.
  cutoff="$(date -u -d '89 days ago' +%Y%m%dT%H%M%SZ)"
  while IFS= read -r path; do
    name="${path##*/}"
    [[ "$name" =~ ^calories-account-([0-9]{8}T[0-9]{6}Z)\.sql\.gpg$ ]] || continue
    [[ -f "$path" && ! -L "$path" ]] || continue
    stamp="${BASH_REMATCH[1]}"
    if [[ "$stamp" > "$cutoff" && "$kept" -lt "$KEEP" ]]; then
      kept=$((kept + 1))
      continue
    fi
    if [[ "$DRY_RUN" == 1 ]]; then echo "would delete $path"; else rm -f -- "$path"; echo "deleted $path"; fi
  done < <(find "$out_abs" -maxdepth 1 -type f -name 'calories-account-*.sql.gpg' | sort -r)
}

if [[ "$PRUNE_ONLY" == 1 ]]; then
  prune
  exit 0
fi

if [[ "$DRY_RUN" == 1 ]]; then
  echo "would dump ${tables[*]} (data only) → gpg AES256 → $file"
  echo "keeping newest $KEEP, younger than 90 days, in $out_abs"
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
