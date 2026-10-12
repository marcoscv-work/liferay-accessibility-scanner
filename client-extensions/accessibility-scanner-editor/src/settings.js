/**
 * Per-site settings, stored in the site-scoped Accessibility Setting object
 * that ships with the Objects client extension. Every switch turns something
 * OFF, so a site without an entry keeps the default behavior: everything on,
 * nothing blocked.
 */

export const DEFAULT_SETTINGS = Object.freeze({
	blockPublishOnCritical: false,
	disableBlogsEditor: false,
	disableCMSEditor: false,
	disablePublishedScan: false,
	disableSiteScan: false,
	disableWebContentEditor: false,
	hidePageEditorPanel: false,
});

/**
 * Headers for session calls to /o/: the portal language (avoids 406 when the
 * browser language is not a portal locale) and the CSRF token, which
 * quarterly releases require on every session request, GET included.
 */
export function apiHeaders(extra = {}) {
	return {
		'Accept': 'application/json',
		'Accept-Language': (window.Liferay?.ThemeDisplay?.getLanguageId?.() || 'en_US').replace('_', '-'),
		...(window.Liferay?.authToken ? {'x-csrf-token': window.Liferay.authToken} : {}),
		...extra,
	};
}

const settingsCache = new Map();
const permissionCache = new Map();

export function loadSettings(groupId) {
	if (!groupId) {
		return Promise.resolve({...DEFAULT_SETTINGS});
	}
	if (!settingsCache.has(groupId)) {
		settingsCache.set(
			groupId,
			fetch(`/o/c/accessibilitysettings/scopes/${groupId}?pageSize=1&sort=dateModified:desc`, {credentials: 'include', headers: apiHeaders()})
				.then((response) => (response.ok ? response.json() : {items: []}))
				.then((page) => {
					const entry = page.items?.[0] || {};
					const settings = {...DEFAULT_SETTINGS};
					Object.keys(settings).forEach((key) => {
						settings[key] = entry[key] === true;
					});
					return settings;
				})
				.catch(() => ({...DEFAULT_SETTINGS}))
		);
	}
	return settingsCache.get(groupId);
}

/**
 * Site scans write Accessibility Scan entries, so the Site tab is offered only
 * to users whose role can add them: admins govern it with regular permissions.
 * Versions that do not return collection actions keep the tab.
 */
export function canCreateScans(groupId) {
	if (!groupId) {
		return Promise.resolve(false);
	}
	if (!permissionCache.has(groupId)) {
		permissionCache.set(
			groupId,
			fetch(`/o/c/accessibilityscans/scopes/${groupId}?pageSize=1`, {credentials: 'include', headers: apiHeaders()})
				.then((response) => (response.ok ? response.json() : null))
				.then((page) => {
					if (!page) {
						return false;
					}
					return page.actions ? Boolean(page.actions.create) : true;
				})
				.catch(() => false)
		);
	}
	return permissionCache.get(groupId);
}
