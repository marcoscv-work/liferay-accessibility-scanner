/**
 * Thin client for the Liferay APIs the scan needs. Authenticates with OAuth2
 * client credentials when LXC injects them, otherwise with LIFERAY_AUTH
 * (user:password) for local development.
 */

const baseURL = (process.env.LIFERAY_URL || 'http://localhost:8080').replace(/\/$/, '');

let token = null;
let tokenExpiry = 0;

async function authorization() {
	const clientId = process.env.LIFERAY_OAUTH_CLIENT_ID;
	const clientSecret = process.env.LIFERAY_OAUTH_CLIENT_SECRET;
	if (clientId && clientSecret) {
		if (!token || Date.now() > tokenExpiry) {
			const response = await fetch(`${baseURL}/o/oauth2/token`, {
				body: new URLSearchParams({
					client_id: clientId,
					client_secret: clientSecret,
					grant_type: 'client_credentials',
				}),
				headers: {'Content-Type': 'application/x-www-form-urlencoded'},
				method: 'POST',
			});
			if (!response.ok) {
				throw new Error(`OAuth2 token request failed: ${response.status}`);
			}
			const json = await response.json();
			token = json.access_token;
			tokenExpiry = Date.now() + (json.expires_in - 30) * 1000;
		}
		return `Bearer ${token}`;
	}
	const basic = process.env.LIFERAY_AUTH;
	if (!basic) {
		throw new Error('Set LIFERAY_OAUTH_CLIENT_ID/SECRET or LIFERAY_AUTH=user:password');
	}
	return `Basic ${Buffer.from(basic).toString('base64')}`;
}

export async function api(path, {body, method = 'GET'} = {}) {
	const response = await fetch(`${baseURL}${path}`, {
		body: body ? JSON.stringify(body) : undefined,
		headers: {
			Accept: 'application/json',
			Authorization: await authorization(),
			...(body ? {'Content-Type': 'application/json'} : {}),
		},
		method,
	});
	if (!response.ok) {
		const text = await response.text();
		throw new Error(`${method} ${path} -> ${response.status} ${text.slice(0, 300)}`);
	}
	return response.status === 204 ? null : response.json();
}

export function portalURL() {
	return process.env.SCAN_BASE_URL || baseURL;
}

export async function getGroup(groupId) {
	return api(`/api/jsonws/group/get-group/group-id/${groupId}`);
}

export async function getSite(groupId) {
	return api(`/o/headless-admin-user/v1.0/sites/${groupId}`);
}

export async function listSitePages(siteERC) {
	const pages = [];
	let page = 1;
	while (true) {
		const result = await api(
			`/o/headless-admin-site/v1.0/sites/${encodeURIComponent(siteERC)}/site-pages?page=${page}&pageSize=100&fields=externalReferenceCode,friendlyUrlPath_i18n,name_i18n,pageSettings`
		);
		pages.push(...(result.items || []));
		if (pages.length >= (result.totalCount || 0) || !(result.items || []).length) {
			break;
		}
		page += 1;
	}
	return pages;
}

export async function createScan(groupId, values) {
	return api(`/o/c/accessibilityscans/scopes/${groupId}`, {body: values, method: 'POST'});
}

export async function updateScan(id, values) {
	return api(`/o/c/accessibilityscans/${id}`, {body: values, method: 'PATCH'});
}

export async function createPage(groupId, scanId, values) {
	return api(`/o/c/accessibilitypages/scopes/${groupId}`, {
		body: {...values, r_accessibilityScanPages_c_accessibilityScanId: scanId},
		method: 'POST',
	});
}

export async function createFindings(groupId, pageId, findings) {
	const items = findings.map((f) => ({...f, r_accessibilityPageFindings_c_accessibilityPageId: pageId}));
	// The batch endpoint is asynchronous; sequential posts keep the PoC simple.
	for (const item of items) {
		await api(`/o/c/accessibilityfindings/scopes/${groupId}`, {body: item, method: 'POST'});
	}
	return items.length;
}
