#!/usr/bin/env bash
#
# Boots an official Liferay DXP Docker image, deploys the client extensions,
# runs scripts/compat-smoke.mjs against it and removes the container. One line
# per version is appended to marketplace/compatibility.log.
#
#   NODE_PATH=~/projects/liferay-portal/modules/node_modules \
#   scripts/compat-test.sh 2026.q3.6 [port]
#
set -uo pipefail

TAG="${1:?image tag, e.g. 2026.q3.6}"
PORT="${2:-8081}"
NAME="accessibility-compat-${TAG//./-}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="${ROOT}/marketplace/compatibility.log"
OUT="${ROOT}/marketplace/compat-${TAG}.txt"

cd "${ROOT}"
npm run -s build >/dev/null && npm run -s build:fragments >/dev/null || { echo "build failed"; exit 1; }

docker rm -f "${NAME}" >/dev/null 2>&1
docker run -d --name "${NAME}" -p "${PORT}:8080" -m 6g \
	-e LIFERAY_JVM_OPTS="-Xms2g -Xmx4g" \
	-e LIFERAY_SETUP_PERIOD_WIZARD_PERIOD_ENABLED=false \
	-e LIFERAY_TERMS_PERIOD_OF_PERIOD_USE_PERIOD_REQUIRED=false \
	-e LIFERAY_USERS_PERIOD_REMINDER_PERIOD_QUERIES_PERIOD_ENABLED=false \
	-e LIFERAY_PASSWORDS_PERIOD_DEFAULT_PERIOD_POLICY_PERIOD_CHANGE_PERIOD_REQUIRED=false \
	"liferay/dxp:${TAG}" >/dev/null || { echo "docker run failed"; exit 1; }

echo "[$TAG] waiting for the portal on :${PORT}"
for i in $(seq 1 120); do
	code=$(curl -sL -o /dev/null -w '%{http_code}' "http://localhost:${PORT}/web/guest")
	[ "${code}" = "200" ] && break
	sleep 10
done
if [ "${code}" != "200" ]; then
	echo "[$TAG] portal did not start" | tee "${OUT}"
	docker logs --tail 80 "${NAME}" >> "${OUT}" 2>&1
	echo "${TAG} $(date +%F) FAIL portal did not start" >> "${LOG}"
	docker rm -f "${NAME}" >/dev/null
	exit 1
fi

echo "[$TAG] deploying the client extensions"
for zip in dist/accessibility-scanner.zip; do
	docker cp "${zip}" "${NAME}:/opt/liferay/deploy/" >/dev/null
done
docker exec -u root "${NAME}" chown -R liferay:liferay /opt/liferay/deploy >/dev/null 2>&1

# The objects batch and the loader are ready when the objects endpoint stops answering 404.
for i in $(seq 1 60); do
	code=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${PORT}/o/c/accessibilityscans")
	[ "${code}" != "404" ] && break
	sleep 5
done
sleep 20

echo "[$TAG] running the smoke test"
LIFERAY_URL="http://127.0.0.1:${PORT}" LIFERAY_AUTH="test@liferay.com:test" node scripts/compat-smoke.mjs dist/accessibility-scanner-fragments.zip > "${OUT}" 2>&1
status=$?
echo "[$TAG] running the content editors smoke test"
LIFERAY_URL="http://127.0.0.1:${PORT}" LIFERAY_AUTH="test@liferay.com:Compat-test-2026!" node scripts/content-smoke.mjs >> "${OUT}" 2>&1
[ $? -ne 0 ] && status=1
cat "${OUT}"
{
	echo "---- server errors mentioning the extension"
	docker logs "${NAME}" 2>&1 | grep -iE "ERROR|Exception" | grep -iE "accessibility|client.extension|batch|object" | tail -20
} >> "${OUT}"
summary=$(tail -1 "$(ls -t "${OUT}")" 2>/dev/null)
if [ ${status} -eq 0 ]; then
	echo "${TAG} $(date +%F) PASS $(grep -c '^PASS' "${OUT}") checks$(grep '^SKIP' "${OUT}" | cut -c7- | sed 's/^/; skipped /' | paste -sd' ' -)" >> "${LOG}"
else
	echo "${TAG} $(date +%F) FAIL $(grep '^FAIL' "${OUT}" | cut -c7- | paste -sd';' -)" >> "${LOG}"
fi
docker rm -f "${NAME}" >/dev/null
exit ${status}
