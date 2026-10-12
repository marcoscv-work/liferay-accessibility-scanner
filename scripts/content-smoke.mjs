/**
 * Smoke test for the content editors: opens the CMS content editor, the Web
 * Content editor and the Blogs editor, writes HTML with known accessibility
 * problems into the rich text field through the editor API (nothing is
 * saved), opens the Accessibility panel and checks the findings.
 *
 *   NODE_PATH=~/projects/liferay-portal/modules/node_modules \
 *   LIFERAY_URL=http://localhost:8080 LIFERAY_AUTH=test@liferay.com:test \
 *   CMS_OBJECT_DEFINITION_ID=35409 CMS_GROUP_ID=38512 \
 *   WEB_CONTENT_STRUCTURE_ID=32533 BLOGS_ENTRY_ID=94240 \
 *   node scripts/content-smoke.mjs
 */
import {createRequire} from 'node:module';
import path from 'node:path';

const require = createRequire(path.join(process.env.NODE_PATH || process.cwd(), 'noop.js'));
const {chromium} = require('playwright');

const base = process.env.LIFERAY_URL || 'http://127.0.0.1:8080';
const [login, password] = (process.env.LIFERAY_AUTH || 'test@liferay.com:test').split(':');
const site = process.env.SITE || 'guest';
let siteGroupId = process.env.SITE_GROUP_ID;


/** Fresh images open first-visit modals (terms of use, welcome); close them. */
async function dismissModals() {
	for (let i = 0; i < 4; i++) {
		await page.waitForTimeout(800);
		if (!(await page.$('.modal.show'))) {
			return;
		}
		const button = page.locator('.modal.show button:has-text("Done"), .modal.show button:has-text("Got It"), .modal.show button:has-text("Close"), .modal.show .close').first();
		if (await button.count()) {
			await button.click().catch(() => {});
		}
		else {
			await page.keyboard.press('Escape');
		}
	}
}

const BAD_HTML =
	'<h1>Big title inside the content</h1>' +
	'<p>Our offer. <a href="/web/guest/offer">Read more</a></p>' +
	'<p>More news. <a href="/web/guest/news">Read more</a></p>' +
	'<p><img src="/o/classic-theme/images/liferay.png"></p>' +
	'<h4>Skipped heading levels</h4>' +
	'<p><a href="https://example.com" target="_blank">External site</a></p>';

const EXPECTED_RULES = ['image-alt', 'liferay-content-h1', 'liferay-generic-link-text', 'heading-order'];


const browser = await chromium.launch();
const page = await browser.newPage({locale: 'en-US', viewport: {height: 1000, width: 1600}});
await page.goto(`${base}/c/portal/login`);
await page.fill('input[name$="_login"]', login);
await page.fill('input[name$="_password"]', password);
await page.locator('input[name$="_password"]').press('Enter');
await page.waitForURL((url) => !/sign-in|\/login|LoginPortlet/.test(url.href), {timeout: 60000}).catch(() => {});
if (/update_password/.test(page.url())) {
	const fresh = process.env.LIFERAY_NEW_PASSWORD || 'Compat-test-2026!';
	await page.fill('input[name$="password1"]', fresh);
	await page.fill('input[name$="password2"]', fresh);
	await page.getByRole('button', {name: /save/i}).click();
	await page.waitForURL((url) => !/update_password/.test(url.href), {timeout: 60000});
}
await page.goto(`${base}/web/${site}`);
await dismissModals();
siteGroupId = siteGroupId || (await page.evaluate(() => Liferay.ThemeDisplay.getScopeGroupId()));

const api = (path, init = {}) =>
	page.evaluate(
		async ({init, path}) => {
			const response = await fetch(path, {
				...init,
				headers: {'Accept': 'application/json', 'Accept-Language': 'en-US', 'Content-Type': 'application/json', 'x-csrf-token': Liferay.authToken},
			});
			return {body: response.ok ? await response.json().catch(() => ({})) : await response.text(), status: response.status};
		},
		{init, path}
	);

// Discover what this portal offers: the Basic Web Content structure, a blog
// entry to edit, and the CMS basic web content structure plus a space.
const companyGroupId = await page.evaluate(() => Liferay.ThemeDisplay.getCompanyGroupId());
// The data engine reads structures from the database; the headless delivery
// list depends on the search index, which is empty right after a fresh boot.
const structures = await api(`/o/data-engine/v2.0/sites/${companyGroupId}/data-definitions/by-content-type/journal?pageSize=100`);
const webContentStructureId = process.env.WEB_CONTENT_STRUCTURE_ID || structures.body?.items?.find((i) => Object.values(i.name || {}).some((n) => /Basic Web Content/i.test(n)))?.id;
const blog = process.env.BLOGS_ENTRY_ID
	? {body: {id: process.env.BLOGS_ENTRY_ID}}
	: await api(`/o/headless-delivery/v1.0/sites/${siteGroupId}/blog-postings`, {body: JSON.stringify({articleBody: '<p>Draft body.</p>', headline: 'Accessibility smoke test entry'}), method: 'POST'});
const cmsDefinitions = await api('/o/object-admin/v1.0/object-definitions?pageSize=200&fields=id,externalReferenceCode');
const cmsDefinitionId = process.env.CMS_OBJECT_DEFINITION_ID || cmsDefinitions.body?.items?.find((i) => i.externalReferenceCode === 'L_CMS_BASIC_WEB_CONTENT')?.id;
let cmsGroupId = process.env.CMS_GROUP_ID;
let cmsSkip = cmsDefinitionId ? '' : 'CMS not available on this portal';
if (cmsDefinitionId && !cmsGroupId) {
	// Create a space through the CMS wizard; its id comes back in the URL.
	try {
		await page.goto(`${base}/web/cms/new-space`);
		await dismissModals();
		const name = page.getByPlaceholder(/space name/i);
		await name.waitFor({timeout: 30000});
		await name.fill(`Accessibility smoke ${Date.now()}`);
		await name.press('Tab');
		await page.getByRole('button', {name: 'Continue'}).click({timeout: 15000});
		await page.waitForURL(/assetLibraryId=\d+/, {timeout: 30000});
		const depotEntryId = /assetLibraryId=(\d+)/.exec(page.url())?.[1];
		const depot = await page.evaluate(async (id) => (await fetch(`/api/jsonws/depot.depotentry/get-depot-entry/depot-entry-id/${id}?p_auth=${Liferay.authToken}`)).json(), depotEntryId);
		cmsGroupId = depot.groupId;
	}
	catch (error) {
		cmsSkip = `could not create a CMS space: ${String(error.message).split('\n')[0].slice(0, 120)}`;
		await page.screenshot({path: '/tmp/content-smoke-cms-space.png'}).catch(() => {});
	}
}

const J = '_com_liferay_journal_web_portlet_JournalPortlet_';
const B = '_com_liferay_blogs_web_portlet_BlogsAdminPortlet_';
const SCREENS = [
	cmsDefinitionId && cmsGroupId
		? {name: 'CMS content editor', url: `/c/cms/add_structured_content_item?objectDefinitionId=${cmsDefinitionId}&groupId=${cmsGroupId}`}
		: {name: 'CMS content editor', skip: cmsSkip || 'CMS not available on this portal'},
	webContentStructureId
		? {name: 'Web Content editor', url: `/group/${site}/~/control_panel/manage?p_p_id=com_liferay_journal_web_portlet_JournalPortlet&p_p_state=maximized&${J}mvcRenderCommandName=%2Fjournal%2Fedit_article&${J}groupId=${siteGroupId}&${J}ddmStructureId=${webContentStructureId}`}
		: {name: 'Web Content editor', skip: `Basic Web Content structure not found (${structures.status} ${JSON.stringify(structures.body?.items?.map?.((i) => Object.values(i.name || {})[0]) || structures.body).slice(0, 120)})`},
	blog.body?.id
		? {name: 'Blogs editor', url: `/group/${site}/~/control_panel/manage?p_p_id=com_liferay_blogs_web_portlet_BlogsAdminPortlet&p_p_state=maximized&${B}mvcRenderCommandName=%2Fblogs%2Fedit_entry&${B}entryId=${blog.body.id}`}
		: {name: 'Blogs editor', skip: `could not create a blog entry (${blog.status})`},
];

let failures = 0;
for (const screen of SCREENS) {
	if (screen.skip) {
		console.log(`SKIP  ${screen.name}  (${screen.skip})`);
		continue;
	}
	try {
		await page.goto(`${base}${screen.url}`, {waitUntil: 'load'});
		await dismissModals();
		// Rich text editors initialize after load.
		await page.waitForFunction(
			() => Object.keys(window.CKEDITOR?.instances || {}).length || document.querySelector('.ck-editor__editable'),
			null,
			{timeout: 60000}
		);
		await page.waitForTimeout(2000);
		const written = await page.evaluate((html) => {
			const ck4 = Object.values(window.CKEDITOR?.instances || {}).filter((i) => !/title|caption|description/i.test(i.name));
			const target = ck4.sort((a, b) => (b.container?.$?.offsetHeight || 0) - (a.container?.$?.offsetHeight || 0))[0];
			if (target) {
				target.setData(html);
				return `CKEditor 4 (${target.name})`;
			}
			const editable = [...document.querySelectorAll('.ck-editor__editable')].find((el) => el.ckeditorInstance);
			if (editable) {
				editable.ckeditorInstance.setData(html);
				return 'CKEditor 5';
			}
			return null;
		}, BAD_HTML);
		if (!written) {
			throw new Error('no rich text editor found');
		}
		await page.waitForTimeout(1000);
		await page.waitForSelector('.lfr-accessibility-scanner__fab', {timeout: 30000});
		await page.click('.lfr-accessibility-scanner__fab');
		await page.waitForSelector('.lfr-accessibility-scanner__panel:not([hidden])');
		// Opening the drawer starts a scan; wait for it, then scan again to read the new content.
		await page.waitForFunction(() => !/Scanning/i.test(document.querySelector('.lfr-accessibility-scanner__panel')?.innerText || ''), null, {timeout: 60000});
		await page.evaluate(async () => {
			const panel = window.__lfrAccessibilityScannerPanel;
			panel.reports.content = null;
			await panel.scan();
		});
		const report = await page.evaluate(() => {
			const panel = window.__lfrAccessibilityScannerPanel;
			return {
				fields: panel.reports.content?.fieldCount,
				rules: [...new Set((panel.reports.content?.findings || []).map((f) => f.ruleId))],
				summary: document.querySelector('.lfr-accessibility-scanner__summary')?.innerText.replace(/\s+/g, ' ').trim(),
				tabs: [...document.querySelectorAll('.lfr-accessibility-scanner [data-source]')].map((tab) => tab.dataset.source),
			};
		});
		const missing = EXPECTED_RULES.filter((rule) => !report.rules.includes(rule));
		const ok = !missing.length;
		failures += ok ? 0 : 1;
		console.log(`${ok ? 'PASS' : 'FAIL'}  ${screen.name}  [${written}] ${report.summary}`);
		console.log(`      rules: ${report.rules.join(', ')}${missing.length ? `  | missing: ${missing.join(', ')}` : ''}`);
		await page.screenshot({path: `/tmp/content-smoke-${screen.name.replace(/\W+/g, '-').toLowerCase()}.png`});
	}
	catch (error) {
		failures += 1;
		console.log(`FAIL  ${screen.name}  ${String(error.message).split('\n')[0]}`);
		await page.screenshot({path: `/tmp/content-smoke-${screen.name.replace(/\W+/g, '-').toLowerCase()}.png`}).catch(() => {});
	}
}

await browser.close();
process.exit(failures ? 1 : 0);
