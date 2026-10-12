/**
 * Propagates the latest version of a fragment to every page using it, the
 * same thing the Fragments admin does from "View usages" > "Propagate".
 * Re-importing a collection never updates existing usages, so run this after
 * scripts/import-fragments.sh. Drives the real admin UI with Playwright
 * because the propagate action is only reachable through its form.
 *
 *   NODE_PATH=~/projects/liferay-portal/modules/node_modules \
 *   LIFERAY_URL=http://localhost:8080 LIFERAY_AUTH=user:password \
 *   node scripts/propagate-fragment.mjs "Accessibility Report" guest
 */
import {createRequire} from 'node:module';
import path from 'node:path';

const require = createRequire(path.join(process.env.NODE_PATH || process.cwd(), 'noop.js'));
const {chromium} = require('playwright');

const [name = 'Accessibility Report', site = 'guest'] = process.argv.slice(2);
const base = process.env.LIFERAY_URL || 'http://localhost:8080';
const [login, password] = (process.env.LIFERAY_AUTH || 'test@liferay.com:test').split(':');
const portlet = 'com_liferay_fragment_web_portlet_FragmentPortlet';

const browser = await chromium.launch();
const page = await browser.newPage({locale: 'en-US', viewport: {height: 1000, width: 1400}});
await page.goto(`${base}/c/portal/login`);
await page.fill('input[name$="_login"]', login);
await page.fill('input[name$="_password"]', password);
await Promise.all([page.waitForNavigation(), page.keyboard.press('Enter')]);

await page.goto(`${base}/group/${site}/~/control_panel/manage?p_p_id=${portlet}`);
const entryId = await page.evaluate((fragmentName) => {
	const link = [...document.querySelectorAll('a[href*="fragment_entry/"]')].find((a) => a.textContent.trim() === fragmentName);
	const match = link && /fragment_entry\/(\d+)/.exec(link.href);
	return match ? match[1] : null;
}, name);
if (!entryId) {
	console.error(`fragment '${name}' not found in site ${site}`);
	await browser.close();
	process.exit(1);
}

await page.goto(`${base}/group/${site}/~/control_panel/manage?p_p_id=${portlet}&_${portlet}_mvcRenderCommandName=%2Ffragment%2Fview_fragment_entry_usages&_${portlet}_fragmentEntryId=${entryId}`);
const boxes = page.locator('input[type="checkbox"][name$="rowIds"]');
const count = await boxes.count();
if (!count) {
	console.log(`no usages of '${name}' to propagate`);
	await browser.close();
	process.exit(0);
}
for (let i = 0; i < count; i++) {
	if (!(await boxes.nth(i).isChecked())) {
		await boxes.nth(i).check();
	}
}
await page.waitForTimeout(400);
await page.locator('button:visible', {hasText: /propagate/i}).first().click();
await page.waitForSelector('.alert-success, .alert-danger', {timeout: 30000});
const alert = (await page.locator('.alert').first().innerText()).replace(/\s+/g, ' ').trim();
console.log(`propagated '${name}' (entry ${entryId}) to ${count} usages: ${alert}`);
await browser.close();
