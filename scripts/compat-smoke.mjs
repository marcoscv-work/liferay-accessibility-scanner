/**
 * Compatibility smoke test against a running Liferay DXP (typically an official
 * Docker image started by scripts/compat-test.sh). Signs in with a real browser
 * session and checks every capability the extension depends on:
 *
 *   1. the globalJS loader is served on rendered pages
 *   2. the Accessibility Scan objects exist and accept a session write
 *   3. the editor toolbar button and the drawer mount in the page editor
 *   4. Draft, Published and Site scans complete and the site scan is stored
 *   5. the panel is torn down when navigating out of the editor
 *   6. the report fragment collection imports cleanly
 *
 * Prints one line per check and a JSON summary; exits 1 when a check fails.
 *
 *   NODE_PATH=~/projects/liferay-portal/modules/node_modules \
 *   LIFERAY_URL=http://localhost:8081 LIFERAY_AUTH=test@liferay.com:test \
 *   node scripts/compat-smoke.mjs dist/accessibility-scanner-fragments.zip
 */
import {createRequire} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(path.join(process.env.NODE_PATH || process.cwd(), 'noop.js'));
const {chromium} = require('playwright');

// 127.0.0.1, not localhost: cookies ignore ports, so localhost would share the
// session cookie with any other portal running on localhost.
const base = process.env.LIFERAY_URL || 'http://127.0.0.1:8081';
const [login, password] = (process.env.LIFERAY_AUTH || 'test@liferay.com:test').split(':');
const fragmentsZip = process.argv[2];
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Panel text once no scan is running (opening the drawer starts one by itself). */
async function settledPanelText(timeout = 120000) {
	const deadline = Date.now() + timeout;
	let text = '';
	while (Date.now() < deadline) {
		text = await page.evaluate(() => document.querySelector('.lfr-accessibility-scanner__panel')?.innerText || '');
		if (!/Scanning|Escaneando|Analizando/i.test(text)) {
			return text;
		}
		await sleep(1000);
	}
	return text;
}

function record(name, ok, detail = '') {
	results.push({detail, name, ok});
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

async function check(name, fn) {
	try {
		const detail = await fn();
		record(name, true, detail || '');
		return true;
	}
	catch (error) {
		record(name, false, String(error.message || error).split('\n')[0].slice(0, 200));
		return false;
	}
}

const browser = await chromium.launch();
const context = await browser.newContext({locale: 'en-US', viewport: {height: 1000, width: 1600}});
const page = await context.newPage();

/*
 * On fresh DXP Docker images, static resources (/o/<module>/... scripts,
 * /combo) answer with a new JSESSIONID cookie that replaces the signed-in
 * session in the test browser. Strip that cookie from static responses so the
 * session survives; pages and APIs are untouched.
 */
await context.route(/\/(combo\/?\?|o\/[^?]*\.(js|css|svg|png|woff2?)|image\/)/, async (route) => {
	try {
		const response = await route.fetch();
		const headers = {...response.headers()};
		delete headers['set-cookie'];
		await route.fulfill({headers, response});
	}
	catch {
		await route.continue();
	}
});
const consoleErrors = [];
page.on('pageerror', (error) => consoleErrors.push(error.message));

/**
 * Signs in with plain HTTP requests through the browser context, so the page
 * shares the session cookies. Local Docker port forwarding made sessions
 * created by the interactive form unstable; the request flow is not.
 */
async function signIn(pass) {
	const loginPage = await context.request.get(`${base}/c/portal/login`);
	const html = await loginPage.text();
	const action = /<form[^>]*?action="([^"]*p_p_id=com_liferay_login_web_portlet_LoginPortlet[^"]*)"/s.exec(html)?.[1]?.replace(/&amp;/g, '&');
	const token = /authToken\s*[:=]\s*['"]([A-Za-z0-9]+)/.exec(html)?.[1];
	if (!action) {
		throw new Error('login form not found');
	}
	await context.request.post(action, {
		form: {
			'_com_liferay_login_web_portlet_LoginPortlet_login': login,
			'_com_liferay_login_web_portlet_LoginPortlet_password': pass,
			'_com_liferay_login_web_portlet_LoginPortlet_rememberMe': 'false',
			'p_auth': token || '',
		},
		maxRedirects: 0,
	});
	await page.goto(`${base}/web/guest`);
	await page.waitForLoadState('load');
}

await check('sign in', async () => {
	await signIn(password);
	// Fresh images force a password change on first sign in; the old one is not accepted again.
	if (/update_password/.test(page.url())) {
		const fresh = process.env.LIFERAY_NEW_PASSWORD || 'Compat-test-2026!';
		await page.fill('input[name$="password1"]', fresh);
		await page.fill('input[name$="password2"]', fresh);
		await page.getByRole('button', {name: /save/i}).click();
		await page.waitForURL((url) => !/update_password/.test(url.href), {timeout: 60000});
		await page.waitForLoadState('load');
	}
	if (/update_terms_of_use/.test(page.url())) {
		await page.locator('button:has-text("I Agree"), input[value="I Agree"]').first().click();
		await page.waitForLoadState('load');
	}
	// Signed in for real means the headless APIs accept the session.
	const api = await page.evaluate(async () => (await fetch('/o/headless-admin-user/v1.0/my-user-account', {headers: {'Accept': 'application/json', 'x-csrf-token': Liferay.authToken}})).status);
	if (api !== 200) {
		throw new Error(`session not accepted by the API (${api}) at ${page.url()}`);
	}
	return page.url();
});

const env = await page.evaluate(() => ({
	companyId: Liferay.ThemeDisplay.getCompanyId(),
	groupId: Liferay.ThemeDisplay.getScopeGroupId(),
	version: document.querySelector('meta[name="generator"]')?.content || '',
}));

await check('globalJS loader on rendered pages', async () => {
	await page.goto(`${base}/web/guest`);
	const src = await page.evaluate(() => [...document.scripts].map((s) => s.src).find((s) => /\/o\/accessibility-scanner-editor\//.test(s)));
	if (!src) {
		throw new Error('no script from /o/accessibility-scanner-editor/ on the page');
	}
	const status = await page.evaluate(async (url) => (await fetch(url)).status, src);
	if (status !== 200) {
		throw new Error(`loader returned ${status}`);
	}
	return new URL(src).pathname;
});

await check('Accessibility Scan objects (site scoped, session write)', async () => {
	const result = await page.evaluate(async (groupId) => {
		const headers = {'Accept': 'application/json', 'Accept-Language': 'en-US', 'Content-Type': 'application/json', 'x-csrf-token': Liferay.authToken};
		const list = await fetch(`/o/c/accessibilityscans/scopes/${groupId}?pageSize=1`, {headers});
		const post = await fetch(`/o/c/accessibilityscans/scopes/${groupId}`, {
			body: JSON.stringify({engineVersion: '', languageId: 'en-US', needsReview: 0, pagesScanned: 0, scanStatus: 'cancelled', score: 0, siteGroupId: String(groupId), siteName: 'compat probe', startDate: new Date().toISOString(), trigger: 'compat', viewport: 'desktop light', violations: 0}),
			headers,
			method: 'POST',
		});
		const created = post.ok ? await post.json() : null;
		if (created?.id) {
			await fetch(`/o/c/accessibilityscans/${created.id}`, {headers, method: 'DELETE'});
		}
		return {list: list.status, post: post.status, text: post.ok ? '' : (await post.text()).slice(0, 160)};
	}, env.groupId);
	if (result.list !== 200 || result.post !== 200) {
		throw new Error(`list ${result.list}, post ${result.post} ${result.text}`);
	}
	return 'list 200, post 200';
});

// A content page to edit: the Guest home on a fresh image.
const editURL = `${base}/web/guest/home?p_l_mode=edit`;

await check('editor toolbar button and drawer', async () => {
	await page.goto(editURL);
	await page.waitForSelector('.lfr-accessibility-scanner__toolbar-button, .lfr-accessibility-scanner__fab', {timeout: 90000});
	await sleep(1500);
	// Fresh images greet the first editor visit with a modal; dismiss it.
	for (let i = 0; i < 3 && (await page.$('.modal.show, .modal-backdrop')); i++) {
		const close = page.locator('.modal.show .close, .modal.show [aria-label="Close"], .modal.show button:has-text("Close"), .modal.show button:has-text("Skip"), .modal.show button:has-text("Got It")').first();
		if (await close.count()) {
			await close.click().catch(() => {});
		}
		else {
			await page.keyboard.press('Escape');
		}
		await sleep(800);
	}
	await page.click('.lfr-accessibility-scanner__toolbar-button, .lfr-accessibility-scanner__fab');
	await page.waitForSelector('.lfr-accessibility-scanner__panel:not([hidden])', {timeout: 30000});
	const docked = await page.$('.lfr-accessibility-scanner__toolbar-button');
	return docked ? 'docked in the editor toolbar' : 'floating button fallback';
});

await check('Draft scan', async () => {
	await settledPanelText();
	await page.evaluate(async () => {
		await window.__lfrAccessibilityScannerPanel.scan();
	});
	const summary = await settledPanelText();
	const match = /(\d+) issues? in (\d+) fragments?|No issues|Sin problemas/i.exec(summary);
	if (!match) {
		throw new Error(`no summary: ${summary.slice(0, 160).replace(/\s+/g, ' ')}`);
	}
	return match[0];
});

await check('Published scan', async () => {
	await page.evaluate(async () => {
		const panel = window.__lfrAccessibilityScannerPanel;
		const tab = [...document.querySelectorAll('.lfr-accessibility-scanner .nav-link')].find((a) => /published|publicada/i.test(a.textContent));
		tab?.click();
		await new Promise((r) => setTimeout(r, 500));
		await panel.scanPublished();
	});
	const summary = await settledPanelText();
	const match = /(\d+) issues? in (\d+) fragments?|No issues/i.exec(summary);
	if (!match) {
		throw new Error(`no summary: ${summary.slice(0, 160).replace(/\s+/g, ' ')}`);
	}
	return match[0];
});

await check('Site scan stored in objects', async () => {
	const stored = await page.evaluate(async (groupId) => {
		const panel = window.__lfrAccessibilityScannerPanel;
		const tab = [...document.querySelectorAll('.lfr-accessibility-scanner .nav-link')].find((a) => /site|sitio/i.test(a.textContent));
		tab?.click();
		await new Promise((r) => setTimeout(r, 2500));
		panel.siteScheme = panel.darkScheme?.supported ? 'both' : 'light';
		await panel.scanSite();
		const response = await fetch(`/o/c/accessibilityscans/scopes/${groupId}?sort=startDate:desc&pageSize=1`, {headers: {'Accept': 'application/json', 'Accept-Language': 'en-US', 'x-csrf-token': Liferay.authToken}});
		const latest = (await response.json()).items?.[0];
		return {error: panel.siteError || '', latest: latest && {pages: latest.pagesScanned, score: latest.score, status: latest.scanStatus, violations: latest.violations}};
	}, env.groupId);
	if (!stored.latest || stored.latest.status !== 'completed' || !stored.latest.pages) {
		throw new Error(`latest scan ${JSON.stringify(stored.latest)} ${stored.error}`);
	}
	return `${stored.latest.pages} pages, score ${stored.latest.score}, ${stored.latest.violations} violations`;
});

await check('Panel torn down outside the editor', async () => {
	await page.evaluate(() => window.Liferay?.Util?.navigate ? Liferay.Util.navigate('/web/guest') : (location.href = '/web/guest'));
	await sleep(5000);
	const left = await page.evaluate(() => document.querySelectorAll('.lfr-accessibility-scanner').length);
	if (left) {
		throw new Error(`${left} panel nodes left`);
	}
	return 'no panel nodes';
});

if (fragmentsZip && fs.existsSync(fragmentsZip)) {
	await check('Report fragment collection import', async () => {
		await page.goto(`${base}/group/guest/~/control_panel/manage?p_p_id=com_liferay_fragment_web_portlet_FragmentPortlet`);
		const result = await page.evaluate(async (zipBase64) => {
			const bytes = Uint8Array.from(atob(zipBase64), (c) => c.charCodeAt(0));
			const form = new FormData();
			form.append('file', new Blob([bytes], {type: 'application/zip'}), 'accessibility-scanner-fragments.zip');
			const ns = '_com_liferay_fragment_web_portlet_FragmentPortlet_';
			const url = `${location.pathname}?p_p_id=com_liferay_fragment_web_portlet_FragmentPortlet&p_p_lifecycle=2&p_p_resource_id=%2Ffragment%2Fimport&p_auth=${Liferay.authToken}&${ns}importType=overwrite&${ns}fragmentCollectionId=0`;
			const response = await fetch(url, {body: form, method: 'POST'});
			return {status: response.status, text: await response.text()};
		}, fs.readFileSync(fragmentsZip).toString('base64'));
		const json = JSON.parse(result.text || '{}');
		const ok = json.importResults?.success?.length && !json.importResults?.error?.length && !json.importResults?.warning?.length;
		if (!ok) {
			throw new Error(`${result.status} ${result.text.slice(0, 200)}`);
		}
		return json.importResults.success.map((s) => s.name).join(', ');
	});
}

record('no uncaught page errors from the scanner', !consoleErrors.some((m) => /accessibility|scanner|axe/i.test(m)), consoleErrors.filter((m) => /accessibility|scanner|axe/i.test(m)).slice(0, 2).join(' | '));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({base, failed: failed.length, passed: results.length - failed.length, version: env.version}));
process.exit(failed.length ? 1 : 0);
