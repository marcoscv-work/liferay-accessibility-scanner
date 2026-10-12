#!/usr/bin/env bash
#
# Imports a fragment collection zip into a site through the Fragments admin
# import command, using a browser-like session (the command needs p_auth).
#
#   LIFERAY_URL=http://localhost:8080 LIFERAY_AUTH=user@example.com:password \
#   scripts/import-fragments.sh dist/accessibility-scanner-fragments.zip guest
#
set -euo pipefail

ZIP="${1:?zip file}"
SITE="${2:-guest}"
LIFERAY_URL="${LIFERAY_URL:-http://localhost:8080}"
LIFERAY_AUTH="${LIFERAY_AUTH:-test@liferay.com:test}"
LOGIN="${LIFERAY_AUTH%%:*}"
PASSWORD="${LIFERAY_AUTH#*:}"

jar=$(mktemp)
trap 'rm -f "${jar}"' EXIT

# 1. Session: render the sign-in page, read the Login portlet action URL and its
#    CSRF token, then post the credentials to it like the browser does.
page=$(curl --silent --location --cookie-jar "${jar}" --cookie "${jar}" "${LIFERAY_URL}/c/portal/login")
action=$(printf '%s' "${page}" | python3 -c 'import re,sys,html; t=sys.stdin.read(); m=re.search(r"<form[^>]*?action=\"([^\"]*p_p_id=com_liferay_login_web_portlet_LoginPortlet[^\"]*)\"", t, re.S); print(html.unescape(m.group(1)) if m else "")')
if [ -z "${action}" ]; then
	echo "login form not found" >&2
	exit 1
fi
# The form's CSRF token is added by the browser at submit time; add it here too.
token=$(printf '%s' "${page}" | grep -oE "authToken[[:space:]]*[:=][[:space:]]*['\"][A-Za-z0-9]+" | grep -oE '[A-Za-z0-9]+$' | head -1)
curl --silent --output /dev/null --cookie-jar "${jar}" --cookie "${jar}" \
	--data-urlencode "p_auth=${token}" \
	--data-urlencode "_com_liferay_login_web_portlet_LoginPortlet_login=${LOGIN}" \
	--data-urlencode "_com_liferay_login_web_portlet_LoginPortlet_password=${PASSWORD}" \
	--data-urlencode "_com_liferay_login_web_portlet_LoginPortlet_rememberMe=false" \
	"${action}"

# 2. The CSRF token of the signed-in session, read from any rendered page.
auth=$(curl --silent --cookie-jar "${jar}" --cookie "${jar}" "${LIFERAY_URL}/web/${SITE}" \
	| grep -oE "authToken[[:space:]]*[:=][[:space:]]*['\"][A-Za-z0-9]+" | grep -oE '[A-Za-z0-9]+$' | head -1)
if [ -z "${auth}" ]; then
	echo "unable to log in as ${LOGIN}" >&2
	exit 1
fi

# 3. The import resource command of the Fragments portlet, in the site scope.
url="${LIFERAY_URL}/group/${SITE}/~/control_panel/manage?p_p_id=com_liferay_fragment_web_portlet_FragmentPortlet&p_p_lifecycle=2&p_p_resource_id=%2Ffragment%2Fimport&p_auth=${auth}&_com_liferay_fragment_web_portlet_FragmentPortlet_importType=overwrite&_com_liferay_fragment_web_portlet_FragmentPortlet_fragmentCollectionId=0"
curl --silent --cookie-jar "${jar}" --cookie "${jar}" \
	--form "file=@${ZIP}" --form "fragmentCollectionId=0" --form "importType=overwrite" \
	"${url}"
echo
