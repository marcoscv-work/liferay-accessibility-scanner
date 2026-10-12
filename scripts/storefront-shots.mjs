/**
 * Product screenshots for the website and the Marketplace storefront.
 * Needs a running local portal with the extensions deployed and a site scan.
 *
 *   NODE_PATH=~/projects/liferay-portal/modules/node_modules \
 *   LIFERAY_URL=http://localhost:8080 LIFERAY_AUTH=user:password \
 *   node scripts/storefront-shots.mjs [outDir]
 */
import {createRequire} from 'node:module';
import path from 'node:path';

const require = createRequire(path.join(process.env.NODE_PATH || process.cwd(), 'noop.js'));
const {chromium} = require('playwright');

const base = process.env.LIFERAY_URL || 'http://localhost:8080';
const [login, password] = (process.env.LIFERAY_AUTH || 'test@liferay.com:test').split(':');
const out = process.argv[2] || 'site/assets/shots';
// Which site and page the editor shots come from: a real-looking site reads
// far better than the rule test page.
const site = process.env.SHOT_SITE || 'liferay-uswds';
const editPage = process.env.SHOT_PAGE || 'landing-page';
const reportURL = process.env.SHOT_REPORT || '/web/guest/accessibility-report';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const context = await browser.newContext({deviceScaleFactor: 2, locale: 'en-US', viewport: {height: 1080, width: 1920}});
const page = await context.newPage();

await page.goto(`${base}/c/portal/login`);
await page.fill('input[name$="_login"]', login);
await page.fill('input[name$="_password"]', password);
await Promise.all([page.waitForNavigation(), page.keyboard.press('Enter')]);

async function openPanel(tab) {
	await page.waitForSelector('.lfr-accessibility-scanner__toolbar-button', {timeout: 60000});
	await sleep(1500);
	const hidden = await page.$eval('.lfr-accessibility-scanner__panel', (el) => el.hidden).catch(() => true);
	if (hidden) {
		await page.click('.lfr-accessibility-scanner__toolbar-button');
	}
	await page.waitForSelector('.lfr-accessibility-scanner__panel:not([hidden])');
	if (tab) {
		await page.click(`.lfr-accessibility-scanner .nav-link:has-text("${tab}")`);
	}
	await sleep(800);
}

/** Element shot with breathing room around it, clamped to the viewport. */
async function shotWithMargin(handle, file, margin = 48) {
	await handle.scrollIntoViewIfNeeded();
	await sleep(300);
	const box = await handle.boundingBox();
	const vp = page.viewportSize();
	const x = Math.max(0, box.x - margin);
	const y = Math.max(0, box.y - margin);
	const clip = {
		height: Math.min(vp.height - y, box.height + margin * 2),
		width: Math.min(vp.width - x, box.width + margin * 2),
		x,
		y,
	};
	await page.screenshot({clip, path: file});
}

async function shotPanel(name, park = [1200, 40]) {
	// Park the pointer so no tooltip shows up in the shot.
	await page.mouse.move(...park);
	await sleep(400);
	const panel = await page.$('.lfr-accessibility-scanner__panel');
	await shotWithMargin(panel, `${out}/${name}-panel.png`, 32);
	await page.screenshot({path: `${out}/${name}.png`});
	console.log('shot', name);
}

async function setProductMenu(open) {
	const isOpen = await page.evaluate(() => document.body.classList.contains('product-menu-open') || !!document.querySelector('.lfr-product-menu-panel.open'));
	if (isOpen !== open && (await page.$('[data-qa-id="productMenu"]'))) {
		await page.locator('[data-qa-id="productMenu"]').first().click();
		await sleep(1500);
	}
}

const api = (p, init = {}) =>
	page.evaluate(
		async ({init, p}) => {
			const r = await fetch(p, {...init, headers: {'Accept': 'application/json', 'Accept-Language': 'en-US', 'Content-Type': 'application/json', 'x-csrf-token': Liferay.authToken}});
			return r.ok ? r.json().catch(() => ({})) : {status: r.status};
		},
		{init, p}
	);

await page.goto(`${base}/web/${site}/${editPage}`);
await setProductMenu(false);

// 1. Draft tab with findings in the page editor.
await page.goto(`${base}/web/${site}/${editPage}?p_l_mode=edit`);
await page.waitForSelector('.page-editor__toolbar', {timeout: 60000});
await sleep(2500);
// Close the fragments sidebar so the canvas shows the page as a visitor sees it.
const sidebarClose = page.locator('.page-editor__sidebar__content button[aria-label="Close"], .page-editor__sidebar__content .btn-monospaced:has(.lexicon-icon-times)').first();
if (await sidebarClose.count()) {
	await sidebarClose.click().catch(() => {});
	await sleep(800);
}
// Scan the site first so the editor tabs do not show the "never scanned" notice.
await openPanel();
await page.evaluate(() => window.__lfrAccessibilityScannerPanel.openSite());
await sleep(3000);
const hasScan = await page.evaluate(() => !/not been scanned|no se ha escaneado/i.test(document.querySelector('.lfr-accessibility-scanner__site')?.innerText || ''));
if (!hasScan || process.env.SHOT_RESCAN) {
	console.log('running a site scan on', site);
	await page.evaluate(async () => {
		const panel = window.__lfrAccessibilityScannerPanel;
		panel.siteScheme = 'both';
		await panel.scanSite();
	});
	await sleep(2000);
}
// Close the site view; the editor toggle reopens the page view.
await page.evaluate(() => window.__lfrAccessibilityScannerPanel.toggle(false));
await sleep(500);
await openPanel('Draft');
await page.evaluate(() => window.__lfrAccessibilityScannerPanel.scan());
await sleep(4000);
await shotPanel('editor-draft');

// 2. Published tab.
await openPanel('Published');
await page.evaluate(() => window.__lfrAccessibilityScannerPanel.scanPublished());
await sleep(15000);
await shotPanel('editor-published');

// 4. Report page, desktop and phone.
await page.goto(`${base}${reportURL}`);
await sleep(4000);
await page.screenshot({fullPage: true, path: `${out}/report.png`});
// The theme header is fixed and would overlap the cards' element shot.
await page.addStyleTag({content: 'header, #banner, .lfr-layout-structure-item-header { visibility: hidden !important; }'});
await page.setViewportSize({height: 1800, width: 1920});
await sleep(800);
await page.evaluate(() => window.scrollTo(0, 0));
const report = await page.$('.accessibility-report__body');
await shotWithMargin(report, `${out}/report-cards.png`, 56);
await page.setViewportSize({height: 1080, width: 1920});
console.log('shot report');
await page.setViewportSize({height: 1000, width: 390});
await sleep(1500);
// Phone shot of the fragment itself (the theme header scrolls away).
await page.evaluate(() => document.querySelector('.accessibility-report').scrollIntoView({block: 'start'}));
await page.evaluate(() => window.scrollBy(0, -16));
await sleep(600);
await page.screenshot({path: `${out}/report-mobile.png`});
console.log('shot report-mobile');
await page.setViewportSize({height: 1080, width: 1920});


// 5. Content editors with realistic content that has typical problems.
const CONTENT = '<h1>Summer opening hours</h1>' +
	'<p>The city library opens every day from 9:00 to 21:00 during July and August. <a href="/web/guest/hours">Read more</a></p>' +
	'<p>New reading rooms are ready on the second floor. <a href="/web/guest/rooms">Read more</a></p>' +
	'<p><img src="/documents/d/liferay-uswds/caleb-fisher-ti49jpndpms-unsplash-jpg"></p>' +
	'<h4>Accessibility services</h4>' +
	'<p>Ask at the front desk for magnifiers and audio guides. <a href="https://www.w3.org/WAI/" target="_blank">Visitor guide</a></p>';
const contentSite = process.env.CONTENT_SITE || 'guest';
const contentGroupId = process.env.CONTENT_GROUP_ID || '20126';
const cmsDefinitionId = process.env.CMS_OBJECT_DEFINITION_ID || '35409';
const cmsGroupId = process.env.CMS_GROUP_ID || '94338';
const webContentStructureId = process.env.WEB_CONTENT_STRUCTURE_ID || '32533';
const blogEntryId = process.env.BLOGS_ENTRY_ID || '94240';
const PARK_CONTENT = [1750, 1070];

async function writeRichText(html, selectorHint) {
	await page.waitForFunction(() => Object.keys(window.CKEDITOR?.instances || {}).length || document.querySelector('.ck-editor__editable'), null, {timeout: 60000});
	await sleep(2000);
	await page.evaluate(
		({hint, html}) => {
			const ck4 = Object.values(window.CKEDITOR?.instances || {}).filter((i) => !/title|caption|description/i.test(i.name));
			const big = ck4.sort((a, b) => (b.container?.$?.offsetHeight || 0) - (a.container?.$?.offsetHeight || 0))[0];
			if (big) {
				big.setData(html);
				return;
			}
			const editables = [...document.querySelectorAll('.ck-editor__editable')].filter((el) => el.ckeditorInstance);
			const target = (hint && editables.find((el) => el.closest(hint))) || editables[editables.length - 1];
			target.ckeditorInstance.setData(html);
		},
		{hint: selectorHint || null, html}
	);
	await sleep(800);
}

async function openContentPanel() {
	await page.click('.lfr-accessibility-scanner__toolbar-button');
	await page.waitForSelector('.lfr-accessibility-scanner__panel:not([hidden])');
	await page.waitForFunction(() => !/Scanning/i.test(document.querySelector('.lfr-accessibility-scanner__panel')?.innerText || ''), null, {timeout: 60000});
	await page.evaluate(async () => {
		const panel = window.__lfrAccessibilityScannerPanel;
		panel.reports.content = null;
		await panel.scan();
	});
	await sleep(800);
}

// CMS content editor (creates a draft in the CMS space).
await page.goto(`${base}/c/cms/add_structured_content_item?objectDefinitionId=${cmsDefinitionId}&groupId=${cmsGroupId}`);
await page.waitForSelector('.lfr-accessibility-scanner__toolbar-button', {timeout: 60000});
await page.fill('[name="ObjectField_title"]', 'Summer opening hours').catch(() => {});
await writeRichText(CONTENT);
await openContentPanel();
await shotPanel('content-cms', PARK_CONTENT);

// Web Content editor: content in the structure field, a vague link in the description.
const J = '_com_liferay_journal_web_portlet_JournalPortlet_';
await page.goto(`${base}/group/${contentSite}/~/control_panel/manage?p_p_id=com_liferay_journal_web_portlet_JournalPortlet&p_p_state=maximized&${J}mvcRenderCommandName=%2Fjournal%2Fedit_article&${J}groupId=${contentGroupId}&${J}ddmStructureId=${webContentStructureId}`);
await page.waitForFunction(() => document.querySelectorAll('.ck-editor__editable').length >= 2, null, {timeout: 60000});
await sleep(2000);
await page.evaluate((html) => {
	const editables = [...document.querySelectorAll('.ck-editor__editable')].filter((el) => el.ckeditorInstance);
	const content = editables.find((el) => el.closest('[data-field-name*="content"]')) || editables[editables.length - 1];
	editables.find((el) => el !== content)?.ckeditorInstance.setData('<p>Opening hours of the city library for the summer. <a href="/web/guest/hours">Click here</a></p>');
	content.ckeditorInstance.setData(html);
}, CONTENT);
await page.locator('[id$="titleMapAsXML"]').first().fill('Summer opening hours').catch(() => {});
await sleep(800);
await openContentPanel();
await page.evaluate(() => document.querySelector('[data-field-name*="content"]')?.scrollIntoView({block: 'start'}));
await sleep(600);
await shotPanel('content-webcontent', PARK_CONTENT);

// Blogs editor (existing entry, retitled for the shot).
await api(`/o/headless-delivery/v1.0/blog-postings/${blogEntryId}`, {body: JSON.stringify({articleBody: CONTENT, headline: 'Summer opening hours'}), method: 'PATCH'});
const B = '_com_liferay_blogs_web_portlet_BlogsAdminPortlet_';
await page.goto(`${base}/group/${contentSite}/~/control_panel/manage?p_p_id=com_liferay_blogs_web_portlet_BlogsAdminPortlet&p_p_state=maximized&${B}mvcRenderCommandName=%2Fblogs%2Fedit_entry&${B}entryId=${blogEntryId}`);
await page.waitForSelector('.lfr-accessibility-scanner__toolbar-button', {timeout: 60000});
await setProductMenu(false);
await writeRichText(CONTENT);
await openContentPanel();
await shotPanel('content-blogs', PARK_CONTENT);

// CMS publish gate: Global site setting on, Publish with a critical issue.
const globalId = await page.evaluate(() => Liferay.ThemeDisplay.getCompanyGroupId());
const previousSettings = await api(`/o/c/accessibilitysettings/scopes/${globalId}?pageSize=20`);
for (const item of previousSettings.items || []) {
	await api(`/o/c/accessibilitysettings/${item.id}`, {method: 'DELETE'});
}
const gate = await api(`/o/c/accessibilitysettings/scopes/${globalId}`, {body: JSON.stringify({blockPublishOnCritical: true, disableBlogsEditor: false}), method: 'POST'});
await page.goto(`${base}/c/cms/add_structured_content_item?objectDefinitionId=${cmsDefinitionId}&groupId=${cmsGroupId}`);
await page.waitForSelector('.lfr-accessibility-scanner__toolbar-button', {timeout: 60000});
await page.fill('[name="ObjectField_title"]', 'New reading rooms').catch(() => {});
await writeRichText('<p>The new reading rooms on the second floor open on Monday.</p><p><img src="/documents/d/liferay-uswds/caleb-fisher-ti49jpndpms-unsplash-jpg"></p>');
await page.locator('button.btn-primary[type="submit"]').first().click();
await page.waitForSelector('.alert-danger', {timeout: 30000}).catch(() => {});
await sleep(1200);
await shotPanel('publish-gate', PARK_CONTENT);

// Settings form (the Global entry that turned the gate on).
const definitions = await api('/o/object-admin/v1.0/object-definitions?search=AccessibilitySetting&fields=className,name');
const settingsClass = (definitions.items || []).find((d) => d.name === 'AccessibilitySetting')?.className || '';
const settingsPortlet = 'com_liferay_object_web_internal_object_definitions_portlet_ObjectDefinitionsPortlet_' + settingsClass.split('#')[1];
await page.goto(`${base}/group/global/~/control_panel/manage?p_p_id=${settingsPortlet}`);
await sleep(2500);
await setProductMenu(false);
const entry = page.locator('table a, .table-list-title a, [role="row"] a').first();
if (await entry.count()) {
	await entry.click();
	await sleep(2500);
}
await page.mouse.move(...PARK_CONTENT);
await page.screenshot({path: `${out}/settings.png`});
console.log('shot settings');
if (gate.id) {
	await api(`/o/c/accessibilitysettings/${gate.id}`, {method: 'DELETE'});
}

// 6. Site view from the Page Tree of the published page, with score stickers (last: it opens the product menu).
await page.goto(`${base}/web/${site}/${editPage}`);
await page.waitForLoadState('load');
await sleep(1500);
if (!(await page.$('.pages-tree'))) {
	await page.locator('[data-qa-id="productMenu"]').first().click();
	await sleep(1500);
	await page.locator('.lfr-product-menu-panel').getByText('Page Tree', {exact: true}).first().click();
}
await page.waitForSelector('.lfr-accessibility-scanner__tree-score', {timeout: 30000});
await page.click('.lfr-accessibility-scanner__tree-button');
await page.waitForSelector('.lfr-accessibility-scanner__panel:not([hidden]) .lfr-accessibility-scanner__site');
await sleep(3000);
await shotPanel('editor-site');

await setProductMenu(false);
await browser.close();
