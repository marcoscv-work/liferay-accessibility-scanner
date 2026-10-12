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

async function shotPanel(name) {
	// Park the pointer so no tooltip shows up in the shot.
	await page.mouse.move(1200, 40);
	await sleep(400);
	const panel = await page.$('.lfr-accessibility-scanner__panel');
	await shotWithMargin(panel, `${out}/${name}-panel.png`, 32);
	await page.screenshot({path: `${out}/${name}.png`});
	console.log('shot', name);
}

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
await openPanel('Site');
await sleep(3000);
// Scan the site first so the other tabs do not show the "never scanned" notice.
const hasScan = await page.evaluate(() => !/not been scanned|no se ha escaneado/i.test(document.querySelector('.lfr-accessibility-scanner__site')?.innerText || ''));
if (!hasScan || process.env.SHOT_RESCAN) {
	console.log('running a site scan on', site);
	await page.evaluate(async () => {
		const panel = window.__lfrAccessibilityScannerPanel;
		panel.siteScheme = panel.darkScheme?.supported ? 'both' : 'light';
		await panel.scanSite();
	});
	await sleep(2000);
}
await openPanel('Draft');
await page.evaluate(() => window.__lfrAccessibilityScannerPanel.scan());
await sleep(4000);
await shotPanel('editor-draft');

// 2. Published tab.
await openPanel('Published');
await page.evaluate(() => window.__lfrAccessibilityScannerPanel.scanPublished());
await sleep(15000);
await shotPanel('editor-published');

// 3. Site tab with the latest scan (run before the other tabs, see above).
await openPanel('Site');
await sleep(3000);
await shotPanel('editor-site');

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

await browser.close();
