#!/usr/bin/env bash
#
# Imports the three object definitions on a self-hosted bundle, where the
# "batch" client extension type is not available (it is LXC only).
#
#   LIFERAY_URL=http://localhost:8080 LIFERAY_AUTH=test@liferay.com:test scripts/create-objects.sh
#
set -euo pipefail

LIFERAY_URL="${LIFERAY_URL:-http://localhost:8080}"
LIFERAY_AUTH="${LIFERAY_AUTH:-test@liferay.com:test}"

BATCH="$(dirname "$0")/../client-extensions/accessibility-scanner-objects/batch/object-definition.batch-engine-data.json"

python3 - "${BATCH}" <<'PY' | while IFS= read -r line; do
import json, sys
batch = json.load(open(sys.argv[1]))
for item in batch["items"]:
    print(json.dumps(item))
PY
	name=$(printf '%s' "${line}" | python3 -c 'import json,sys;print(json.load(sys.stdin)["name"])')
	erc=$(printf '%s' "${line}" | python3 -c 'import json,sys;print(json.load(sys.stdin)["externalReferenceCode"])')
	echo "upserting ${name} (${erc})"
	code=$(curl \
		--silent \
		--output /tmp/accessibility-objects-response.json \
		--write-out '%{http_code}' \
		--request PUT \
		--header 'Content-Type: application/json' \
		--user "${LIFERAY_AUTH}" \
		--data "${line}" \
		"${LIFERAY_URL}/o/object-admin/v1.0/object-definitions/by-external-reference-code/${erc}")
	if [ "${code}" != "200" ]; then
		echo "  failed (${code}):"
		cat /tmp/accessibility-objects-response.json
		echo
		exit 1
	fi
done

echo "publishing definitions"
for erc in ACCESSIBILITY_FINDING ACCESSIBILITY_PAGE ACCESSIBILITY_SCAN; do
	id=$(curl --silent --user "${LIFERAY_AUTH}" "${LIFERAY_URL}/o/object-admin/v1.0/object-definitions/by-external-reference-code/${erc}" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d["id"] if d.get("status",{}).get("code")!=0 else "")')
	if [ -n "${id}" ]; then
		curl --silent --output /dev/null --request POST --user "${LIFERAY_AUTH}" "${LIFERAY_URL}/o/object-admin/v1.0/object-definitions/${id}/publish"
		echo "  published ${erc}"
	else
		echo "  ${erc} already published"
	fi
done
