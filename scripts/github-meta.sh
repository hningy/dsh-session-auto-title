#!/usr/bin/env bash
# Fill the repository metadata a scan-based marketplace reads but that git
# cannot set: the description, the discovery topics, and a Release for the
# tagged version. Run it yourself so the token never leaves your machine.
#
#   GH_TOKEN=ghp_xxx bash scripts/github-meta.sh
#
# The token needs `repo` scope (classic) or Contents+Metadata read/write plus
# Issues/Releases write (fine-grained).

set -euo pipefail

OWNER="${OWNER:-hningy}"
REPO="${REPO:-dsh-session-auto-title}"
TAG="${TAG:-v1.1.2}"
DESCRIPTION="Automatic conversation-wide session titles for DeepSeek Harness — retitles sessions as the topic evolves, with a Settings page for the switch and cadence."

if [ -z "${GH_TOKEN:-}" ]; then
  echo "GH_TOKEN is not set. Create one at https://github.com/settings/tokens" >&2
  exit 1
fi

api() {
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -sS -X "$method" \
      -H "Authorization: Bearer $GH_TOKEN" \
      -H "Accept: application/vnd.github+json" \
      -H "X-GitHub-Api-Version: 2022-11-28" \
      -H "Content-Type: application/json" \
      -d "$body" \
      "https://api.github.com$path"
  else
    curl -sS -X "$method" \
      -H "Authorization: Bearer $GH_TOKEN" \
      -H "Accept: application/vnd.github+json" \
      -H "X-GitHub-Api-Version: 2022-11-28" \
      "https://api.github.com$path"
  fi
}

echo "==> description"
api PATCH "/repos/$OWNER/$REPO" "$(printf '{"description":%s,"homepage":%s}' \
  "$(printf '%s' "$DESCRIPTION" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')" \
  "\"https://www.npmjs.com/package/$REPO\"")" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("   ", d.get("description") or d.get("message"))'

echo "==> topics"
api PUT "/repos/$OWNER/$REPO/topics" \
  '{"names":["dsh-plugin","deepseek-harness","dsh","session-title","plugin"]}' \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("   ", d.get("names") or d.get("message"))'

echo "==> release $TAG"
if api GET "/repos/$OWNER/$REPO/releases/tags/$TAG" | grep -q '"id"'; then
  echo "    already exists"
else
  NOTES=$(python3 - <<'PY'
import json, re, pathlib
text = pathlib.Path('CHANGELOG.md').read_text()
blocks = re.split(r'^## ', text, flags=re.M)
head = []
for block in blocks[1:]:
    version, _, body = block.partition('\n')
    head.append(f"### {version.strip()}\n{body.strip()}\n")
print("\n".join(head).strip())
PY
)
  api POST "/repos/$OWNER/$REPO/releases" \
    "$(python3 -c 'import json,os,sys; print(json.dumps({"tag_name": os.environ["TAG"], "name": os.environ["TAG"], "body": sys.stdin.read(), "draft": False, "prerelease": False}))' <<<"$NOTES")" \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); print("   ", d.get("html_url") or d.get("message"))'
fi

echo
echo "Done. Check: https://github.com/$OWNER/$REPO"
