#!/usr/bin/env bash
# ============================================================================
# Branding API smoke test — Laravel VPS mode
# ----------------------------------------------------------------------------
# Usage:
#   ./test-branding-api.sh <BASE_URL> <BEARER_TOKEN> [LOGO_PATH]
#
# Example:
#   ./test-branding-api.sh https://erp.irlbd.com/api 1|abcdef... ./logo.png
#
# Checks:
#   1. GET    /v1/admin/branding             -> 200 + array
#   2. PUT    /v1/admin/branding             -> 200 + {updated:N}
#   3. POST   /v1/admin/branding/logo        -> 200 + {url}
#   4. POST   /v1/admin/branding/logo (bad)  -> 422 validation error
# ============================================================================
set -u

BASE="${1:-}"
TOKEN="${2:-}"
LOGO="${3:-}"

if [[ -z "$BASE" || -z "$TOKEN" ]]; then
  echo "Usage: $0 <BASE_URL> <BEARER_TOKEN> [LOGO_PATH]" >&2
  exit 2
fi

AUTH=(-H "Authorization: Bearer $TOKEN" -H "Accept: application/json")
PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; PASS=$((PASS+1)); }
bad()  { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

echo "▶ 1) GET $BASE/v1/admin/branding"
CODE=$(curl -s -o /tmp/br_get.json -w "%{http_code}" "${AUTH[@]}" "$BASE/v1/admin/branding")
[[ "$CODE" == "200" ]] && ok "HTTP 200" || bad "HTTP $CODE — $(cat /tmp/br_get.json)"

echo "▶ 2) PUT $BASE/v1/admin/branding (software_name=API-Test)"
CODE=$(curl -s -o /tmp/br_put.json -w "%{http_code}" -X PUT "${AUTH[@]}" \
  -H "Content-Type: application/json" \
  -d '{"settings":[{"setting_key":"software_name","setting_value":"API-Test"}]}' \
  "$BASE/v1/admin/branding")
[[ "$CODE" == "200" ]] && ok "HTTP 200 — $(cat /tmp/br_put.json)" || bad "HTTP $CODE — $(cat /tmp/br_put.json)"

if [[ -n "$LOGO" && -f "$LOGO" ]]; then
  echo "▶ 3) POST $BASE/v1/admin/branding/logo ($LOGO)"
  CODE=$(curl -s -o /tmp/br_up.json -w "%{http_code}" -X POST "${AUTH[@]}" \
    -F "file=@$LOGO" -F "setting_key=company_logo_url" \
    "$BASE/v1/admin/branding/logo")
  [[ "$CODE" == "200" ]] && ok "HTTP 200 — $(cat /tmp/br_up.json)" || bad "HTTP $CODE — $(cat /tmp/br_up.json)"
else
  echo "  ⏭  Skipped logo upload (no LOGO_PATH given)"
fi

echo "▶ 4) POST $BASE/v1/admin/branding/logo (bad setting_key — expect 422)"
TMP=$(mktemp --suffix=.txt); echo "not-an-image" > "$TMP"
CODE=$(curl -s -o /tmp/br_bad.json -w "%{http_code}" -X POST "${AUTH[@]}" \
  -F "file=@$TMP" -F "setting_key=invalid_slot" \
  "$BASE/v1/admin/branding/logo")
rm -f "$TMP"
[[ "$CODE" == "422" ]] && ok "Validation rejected (HTTP 422)" || bad "Expected 422 got $CODE — $(cat /tmp/br_bad.json)"

echo
echo "Done. Passed: $PASS  Failed: $FAIL"
exit $([[ $FAIL -eq 0 ]] && echo 0 || echo 1)
