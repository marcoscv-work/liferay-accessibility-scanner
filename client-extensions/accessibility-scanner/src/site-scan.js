/**
 * Site scan from the browser, no server involved.
 *
 * For every page of the site the HTML is fetched WITHOUT credentials, which is
 * exactly what an anonymous visitor receives, and rendered in a hidden
 * same-origin iframe through `srcdoc` with a `<base href>` so stylesheets,
 * fragment scripts and the scanner loader load as on the live page. The
 * scanner runs inside the frame; findings are stored in the Accessibility
 * Scan Objects with the current user's session.
 */

import {apiHeaders} from './settings.js';
import {checkDocuments, checkPageDefinition, checkPageTitles, checkTokenContrast, listPagesViaJSONWS, resolvePageInfo} from './model.js';

const FRAME_NAME = 'lfr-accessibility-published-scan';
const IMPACT_WEIGHT = {critical: 10, minor: 1, moderate: 2, serious: 5};
const CONCURRENT_WRITES = 6;

function authHeaders(json = true) {
	return apiHeaders(json ? {'Content-Type': 'application/json'} : {});
}

async function api(path, {body, method = 'GET'} = {}) {
	const response = await fetch(path, {
		body: body ? JSON.stringify(body) : undefined,
		credentials: 'include',
		headers: authHeaders(Boolean(body)),
		method,
	});
	if (!response.ok) {
		throw new Error(`${method} ${path.split('?')[0]} -> ${response.status}`);
	}
	return response.status === 204 ? null : response.json();
}


export function score(findings) {
	const penalty = findings
		.filter((f) => !f.needsReview)
		.reduce((sum, f) => sum + (IMPACT_WEIGHT[f.impact] || 1), 0);
	return Math.max(0, 100 - penalty);
}

async function listSitePages(siteERC, privateLayout) {
	const pages = [];
	let page = 1;
	for (;;) {
		const result = await api(
			`/o/headless-admin-site/v1.0/sites/${encodeURIComponent(siteERC)}/site-pages?privateLayout=${privateLayout}&page=${page}&pageSize=100&fields=externalReferenceCode,friendlyUrlPath_i18n,name_i18n`
		);
		pages.push(...(result.items || []).map((p) => ({...p, privateLayout})));
		if (!(result.items || []).length || pages.length >= (result.totalCount || 0)) {
			break;
		}
		page += 1;
	}
	return pages;
}

/**
 * Public and private pages; private ones live under /group/<site> and need the
 * session. Falls back to JSON-WS when headless-admin-site is not available.
 */
async function listAllPages(siteERC, groupId, languageId) {
	const list = (privateLayout) =>
		listSitePages(siteERC, privateLayout).catch(() => listPagesViaJSONWS(groupId, privateLayout, languageId));
	const [publicPages, privatePages] = await Promise.all([list(false), list(true).catch(() => [])]);
	return [...publicPages, ...privatePages];
}

/** Fetches the page as an anonymous visitor; falls back to the session for private pages. */
async function fetchPageHTML(url) {
	let response = await fetch(url, {credentials: 'omit', redirect: 'follow'});
	let visibility = 'anonymous';
	const redirectedToLogin = /\/login|p_p_id=com_liferay_login_web/.test(response.url);
	if (!response.ok || redirectedToLogin) {
		response = await fetch(url, {credentials: 'include', redirect: 'follow'});
		visibility = 'authenticated';
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`);
		}
	}
	return {html: await response.text(), visibility};
}

/**
 * Adds the base URL and, when asked, forces a color scheme. Clay and the style
 * book variants resolve `light-dark()` from the `color-scheme` property and
 * read `data-color-scheme`, so both are set on the root element.
 */
function withBase(html, url, scheme) {
	let head = `<base href="${url.replace(/"/g, '&quot;')}">`;
	if (scheme === 'light' || scheme === 'dark') {
		head += `<meta name="color-scheme" content="${scheme}"><style>:root{color-scheme:${scheme} !important}</style>`;
	}
	let out = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => `${m}${head}`) : head + html;
	if (scheme === 'light' || scheme === 'dark') {
		out = out.replace(/<html([^>]*)>/i, (m, attrs) => `<html${attrs.replace(/\sdata-color-scheme="[^"]*"/, '')} data-color-scheme="${scheme}">`);
	}
	return out;
}

/** Renders the HTML in a hidden frame and runs the scanner that the loader starts there. */
async function auditHTML(html, url, {scheme, timeout = 45000} = {}) {
	const frame = document.createElement('iframe');
	frame.name = FRAME_NAME;
	frame.setAttribute('aria-hidden', 'true');
	frame.setAttribute('tabindex', '-1');
	frame.setAttribute('title', url);
	frame.style.cssText =
		'position:fixed;left:-20000px;top:0;width:1280px;height:900px;border:0;visibility:visible;';
	frame.srcdoc = withBase(html, url, scheme);
	document.body.appendChild(frame);
	try {
		const scannerSrc = document.querySelector('script[data-lfr-accessibility-scanner]')?.src;
		const deadline = Date.now() + timeout;
		let injected = false;
		for (;;) {
			const win = frame.contentWindow;
			const doc = frame.contentDocument;
			if (win && typeof win.__lfrAccessibilityRunScan === 'function') {
				break;
			}
			if (Date.now() > deadline) {
				throw new Error('scanner did not start in the frame');
			}
			// The anonymous HTML carries the loader; inject the scanner only if it did not.
			if (!injected && doc?.readyState === 'complete' && doc.body && scannerSrc && !win.__lfrAccessibilityScannerLoader) {
				const script = doc.createElement('script');
				script.src = scannerSrc;
				doc.body.appendChild(script);
				injected = true;
			}
			await new Promise((r) => setTimeout(r, 150));
		}
		// Give fragment scripts and lazy content a moment to settle.
		await new Promise((r) => setTimeout(r, 400));
		const report = await frame.contentWindow.__lfrAccessibilityRunScan();
		report.title = frame.contentDocument?.title || '';
		report.findings.forEach((f) => {
			f.element = null;
			f.context.fragmentElement = null;
		});
		return report;
	}
	finally {
		frame.remove();
	}
}

function toFindingEntry(f) {
	return {
		editableId: f.context.editableId || '',
		findingStatus: 'open',
		fragmentName: f.context.fragmentName || '',
		help: f.help,
		helpUrl: f.helpUrl,
		html: (f.html || '').slice(0, 4000),
		impact: f.impact,
		itemId: f.context.itemId || '',
		message: (f.message || '').slice(0, 4000),
		needsReview: Boolean(f.needsReview),
		portletId: f.context.portletId || '',
		ruleId: f.ruleId,
		selector: (f.selector || '').slice(0, 2000),
		source: f.source,
		wcag: (f.wcag || []).join(', '),
	};
}

async function writeFindings(groupId, pageId, findings) {
	const entries = findings.map((f) => ({...toFindingEntry(f), r_accessibilityPageFindings_c_accessibilityPageId: pageId}));
	for (let i = 0; i < entries.length; i += CONCURRENT_WRITES) {
		await Promise.all(
			entries.slice(i, i + CONCURRENT_WRITES).map((entry) => api(`/o/c/accessibilityfindings/scopes/${groupId}`, {body: entry, method: 'POST'}))
		);
	}
}

/* The Objects are site scoped: entries live under /scopes/{groupId}. */
export async function latestScan(groupId) {
	const result = await api(
		`/o/c/accessibilityscans/scopes/${groupId}?sort=startDate:desc&pageSize=2&nestedFields=accessibilityScanPages`
	);
	return result.items || [];
}

/** Theme slug from the theme CSS link of the served HTML (`/o/prism-theme/css/...`). */
function themeOf(html) {
	const match = /\/o\/([a-z0-9_-]*theme[a-z0-9_-]*)\/css\/(?:clay|main)\b/i.exec(html || '');
	if (!match) {
		return {name: '', slug: ''};
	}
	return {name: prettyThemeName(match[1]), slug: match[1].toLowerCase().replace(/[-_]?theme(?:[-_]css)?$/, '')};
}

/** "liferay-uswds-theme-css" -> "Liferay USWDS", "prism-theme" -> "Prism". */
function prettyThemeName(contextPath) {
	const acronyms = ['dsfr', 'ecl', 'gcds', 'uswds', 'w3c'];
	return contextPath
		.replace(/[-_]?theme(?:[-_]css)?$/i, '')
		.split(/[-_]/)
		.filter(Boolean)
		.map((part) => (acronyms.includes(part.toLowerCase()) ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
		.join(' ');
}

/** Style book applied to a page: the explicit one, else the site default for its theme. */
function styleBookOf(styleBooks, spec, themeSlug) {
	const erc = spec?.styleBookItemExternalReference?.externalReferenceCode;
	const explicit = erc && styleBooks.find((sb) => sb.externalReferenceCode === erc);
	const fallback = styleBooks.find((sb) => sb.defaultStyleBook && String(sb.themeId || '').toLowerCase().startsWith(`${themeSlug}_`));
	const entry = explicit || fallback;
	return entry ? entry.name_i18n?.['en-US'] || entry.name || '' : '';
}

/**
 * Runs the whole site scan. `onProgress` receives {done, total, page, status}.
 * `signal` (AbortSignal) cancels between pages.
 */
export async function runSiteScan({onProgress = () => {}, schemes = ['light'], signal, viewport = 'desktop'} = {}) {
	const info = await resolvePageInfo();
	const site = await api(`/o/headless-admin-user/v1.0/sites/${info.groupId}`).catch(() => null);
	const languages = site?.availableLanguages || [];
	const defaultLanguage = (window.Liferay?.ThemeDisplay?.getDefaultLanguageId?.() || languages[0] || 'en-US').replace('_', '-');
	const pages = await listAllPages(info.siteERC, info.groupId, defaultLanguage);
	const styleBooks = await api(`/o/headless-admin-site/v1.0/sites/${encodeURIComponent(info.siteERC)}/style-books?pageSize=100`)
		.then((r) => r.items || [])
		.catch(() => []);
	const passes = [];
	for (const sitePage of pages) {
		for (const scheme of schemes) {
			passes.push({scheme, sitePage});
		}
	}

	const scan = await api(`/o/c/accessibilityscans/scopes/${info.groupId}`, {
		body: {
			engineVersion: '',
			languageId: defaultLanguage,
			needsReview: 0,
			pagesScanned: 0,
			scanStatus: 'running',
			score: 0,
			siteGroupId: String(info.groupId),
			siteName: site?.name || info.siteERC,
			startDate: new Date().toISOString(),
			trigger: 'browser',
			viewport: `${viewport} ${schemes.join('+')}`,
			violations: 0,
		},
		method: 'POST',
	});

	const results = [];
	let engine = '';
	let siteFindings = [];

	// Site-level content checks once: titles, library images, style book tokens.
	try {
		siteFindings = siteFindings.concat(checkPageTitles(pages, defaultLanguage));
		const documents = await api(
			`/o/headless-delivery/v1.0/sites/${info.groupId}/documents?flatten=true&pageSize=200&fields=contentType,contentUrl,description,fileExtension,fileName,id,title`
		);
		siteFindings = siteFindings.concat(checkDocuments(documents.items || []));
		// Images shared from the Global site are used across sites too.
		const companyGroupId = window.Liferay?.ThemeDisplay?.getCompanyGroupId?.();
		if (companyGroupId && String(companyGroupId) !== String(info.groupId)) {
			const globalDocuments = await api(
				`/o/headless-delivery/v1.0/sites/${companyGroupId}/documents?flatten=true&pageSize=200&fields=contentType,contentUrl,description,fileExtension,fileName,id,title`
			).catch(() => ({items: []}));
			siteFindings = siteFindings.concat(
				checkDocuments(globalDocuments.items || []).map((f) => ({...f, context: {...f.context, fragmentName: 'Documents and Media (Global)'}}))
			);
		}
	}
	catch {
		// site-level checks are best effort
	}
	siteFindings = siteFindings.concat(checkTokenContrast());

	let index = 0;
	for (const {scheme, sitePage} of passes) {
		if (signal?.aborted) {
			break;
		}
		index += 1;
		const friendly = sitePage.friendlyUrlPath_i18n?.[defaultLanguage] || Object.values(sitePage.friendlyUrlPath_i18n || {})[0];
		const baseTitle = sitePage.name_i18n?.[defaultLanguage] || Object.values(sitePage.name_i18n || {})[0] || friendly;
		const title = schemes.length > 1 ? `${baseTitle} (${scheme})` : baseTitle;
		if (!friendly) {
			continue;
		}
		const sitePath = sitePage.privateLayout ? info.sitePath.replace(/^\/web\//, '/group/') : info.sitePath;
		const url = `${window.location.origin}${sitePath}${friendly}`;
		onProgress({done: index - 1, page: title, status: 'scanning', total: passes.length});
		try {
			const {html, visibility} = await fetchPageHTML(url);
			const report = await auditHTML(html, url, {scheme});
			engine = report.engineVersion || engine;

			let findings = report.findings;
			const theme = themeOf(html);
			let styleBookName = '';
			try {
				const definition = await api(
					`/o/headless-admin-site/v1.0/sites/${encodeURIComponent(info.siteERC)}/site-pages/${encodeURIComponent(sitePage.externalReferenceCode)}?nestedFields=pageSpecifications`
				);
				const spec = (definition.pageSpecifications || []).find((s) => s.status === 'Approved');
				styleBookName = styleBookOf(styleBooks, spec, theme.slug);
				findings = findings.concat(checkPageDefinition(spec, languages, defaultLanguage));
			}
			catch {
				// page definition is optional
				styleBookName = styleBookOf(styleBooks, null, theme.slug);
			}
			if (index === 1) {
				findings = findings.concat(siteFindings);
			}
			// Site-level findings and translations do not depend on the scheme.
			if (scheme !== schemes[0]) {
				findings = findings.filter((f) => f.source !== 'model');
			}

			const violations = findings.filter((f) => !f.needsReview).length;
			const needsReview = findings.length - violations;
			const pageScore = score(findings);
			const stored = await api(`/o/c/accessibilitypages/scopes/${info.groupId}`, {
				body: {
					experience: `${visibility}${schemes.length > 1 ? ` · ${scheme}` : ''}`,
					friendlyUrl: friendly,
					languageId: defaultLanguage,
					needsReview,
					pageTitle: title,
					plid: '',
					r_accessibilityScanPages_c_accessibilityScanId: scan.id,
					score: pageScore,
					styleBookName,
					themeName: theme.name,
					url,
					violations,
				},
				method: 'POST',
			});
			await writeFindings(info.groupId, stored.id, findings);
			results.push({friendly, needsReview, pageId: stored.id, scheme, score: pageScore, styleBookName, themeName: theme.name, title, url, violations, visibility});
		}
		catch (error) {
			results.push({error: error.message, friendly, title, url});
		}
		onProgress({done: index, page: title, status: 'scanned', total: passes.length});
	}

	const scanned = results.filter((r) => !r.error);
	const summary = {
		endDate: new Date().toISOString(),
		engineVersion: engine ? `axe-core ${engine} + Liferay rules + content checks` : '',
		needsReview: scanned.reduce((s, r) => s + r.needsReview, 0),
		pagesScanned: scanned.length,
		scanStatus: signal?.aborted ? 'cancelled' : 'completed',
		score: scanned.length ? Math.round(scanned.reduce((s, r) => s + r.score, 0) / scanned.length) : 0,
		violations: scanned.reduce((s, r) => s + r.violations, 0),
	};
	await api(`/o/c/accessibilityscans/${scan.id}`, {body: summary, method: 'PATCH'});
	return {id: scan.id, ...summary, results, sitePath: info.sitePath, startDate: scan.startDate};
}
