/**
 * Composes the raw product screenshots into framed marketing images: soft
 * background, generous margins, rounded frame with shadow, and a legible crop
 * for the hero. Reads site/assets/shots/*.png, writes site/assets/shots/framed.
 *
 *   NODE_PATH=~/projects/liferay-portal/modules/node_modules node scripts/compose-shots.mjs
 */
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(path.join(process.env.NODE_PATH || process.cwd(), 'noop.js'));
const {chromium} = require('playwright');

const root = path.resolve(process.argv[2] || 'site/assets/shots');
const out = path.join(root, 'framed');
fs.mkdirSync(out, {recursive: true});

const ACCENT = '#ea580c';
const BG = `radial-gradient(70% 60% at 85% 0%, #ffe8d6 0%, rgba(255, 232, 214, 0) 70%), linear-gradient(180deg, #fbfcfe 0%, #eef2f7 100%)`;

const PANEL_CROP = {x: 64 / 624, y: 120 / 1984, w: 1 - 64 / 624, h: 1 - 120 / 1984};

const COMPOSITIONS = [
	// Full editor behind, the drawer zoomed in front: nothing gets cut mid-sentence.
	{height: 1000, layers: {base: 'editor-draft.png', overlay: 'editor-draft-panel.png', overlayCrop: 0.58}, name: 'hero-editor', padding: 72, width: 1600},
	{crop: PANEL_CROP, height: 1240, name: 'panel-draft', padding: 80, src: 'editor-draft-panel.png', width: 900},
	{crop: PANEL_CROP, height: 1240, name: 'panel-published', padding: 80, src: 'editor-published-panel.png', width: 900},
	{bar: true, height: 1000, name: 'page-tree', padding: 72, src: 'editor-site.png', url: 'yoursite.com/web/guest/home', width: 1600},
	{bar: true, height: 1000, name: 'content-cms', padding: 72, src: 'content-cms.png', url: 'yoursite.com/web/cms/e/basic-web-content', width: 1600},
	{bar: true, height: 1000, name: 'content-webcontent', padding: 72, src: 'content-webcontent.png', url: 'yoursite.com/group/guest/~/control_panel/manage', width: 1600},
	{bar: true, height: 1000, name: 'content-blogs', padding: 72, src: 'content-blogs.png', url: 'yoursite.com/group/guest/~/control_panel/manage', width: 1600},
	{bar: true, height: 1000, name: 'publish-gate', padding: 72, src: 'publish-gate.png', url: 'yoursite.com/web/cms/e/basic-web-content', width: 1600},
	{crop: {x: 0.295, y: 0.045, w: 0.41, h: 0.55}, height: 900, name: 'settings', padding: 64, src: 'settings.png', width: 1100},
	{bleed: true, crop: {x: 0, y: 0, w: 1, h: 1}, height: 1100, name: 'report-desktop', padding: 72, src: 'report-cards.png', width: 1600},
	{height: 1240, name: 'report-mobile', padding: 90, phone: true, src: 'report-mobile.png', width: 760},
];

function dataURI(file) {
	// setContent pages have an opaque origin and cannot load file:// images.
	return 'data:image/png;base64,' + fs.readFileSync(path.join(root, file)).toString('base64');
}

/** Full editor behind, the drawer zoomed in front: nothing gets cut mid-sentence. */
function layered({height, layers, padding, width}) {
	const innerW = width - padding * 2;
	const innerH = height - padding * 2;
	const baseW = Math.round(innerW * 0.8);
	const overlayW = Math.round(innerW * 0.34);
	const overlayH = Math.min(innerH - 40, Math.round(overlayW * (1984 / 560) * layers.overlayCrop));
	return `<!doctype html><html><head><meta charset="utf-8"><style>
		html, body { margin: 0; }
		body { width: ${width}px; height: ${height}px; background: ${BG}; position: relative; overflow: hidden; }
		.base { position: absolute; left: ${padding}px; top: ${padding}px; width: ${baseW}px; border-radius: 18px; border: 1px solid #e2e8f0; box-shadow: 0 30px 60px -30px rgba(15, 23, 42, 0.3); overflow: hidden; background: #fff; }
		.base img { display: block; width: 100%; }
		.overlay { position: absolute; right: ${padding}px; bottom: ${padding}px; width: ${overlayW}px; height: ${overlayH}px; border-radius: 18px; border: 1px solid #e2e8f0; box-shadow: 0 50px 90px -30px rgba(15, 23, 42, 0.45), 0 0 0 10px rgba(255, 255, 255, 0.65); overflow: hidden; background: #fff; }
		.overlay img { display: block; width: ${(624 / 560 * 100).toFixed(2)}%; margin-left: -${(64 / 560 * 100).toFixed(2)}%; margin-top: -${(64 / 560 * 100).toFixed(2)}%; }
	</style></head><body>
		<div class="base"><img src="${dataURI(layers.base)}" alt=""></div>
		<div class="overlay"><img src="${dataURI(layers.overlay)}" alt=""></div>
	</body></html>`;
}

function html(comp) {
	if (comp.layers) {
		return layered(comp);
	}
	const {bar, bleed, crop, height, padding, phone, src, width} = comp;
	const file = dataURI(src);
	const innerW = (phone ? Math.min(width, 760) : width) - padding * 2;
	const innerH = height - padding * 2 + (bleed ? 400 : 0);
	let media;
	if (crop) {
		// Scale the image so the cropped region fills the frame, then offset it.
		const scaleX = innerW / crop.w;
		media = `<div class="clip"><img src="${file}" style="width:${scaleX}px;margin-left:${-crop.x * scaleX}px;margin-top:${-crop.y * (scaleX)}px" alt=""></div>`;
	}
	else {
		media = `<img src="${file}" style="max-width:${innerW}px;max-height:${innerH - (bar ? 44 : 0)}px;width:auto;height:auto" alt="">`;
	}
	return `<!doctype html><html><head><meta charset="utf-8"><style>
		html, body { margin: 0; }
		body { width: ${width}px; height: ${height}px; background: ${BG}; display: grid; place-items: center; font-family: ui-monospace, Menlo, monospace; ${bleed ? 'overflow: hidden; display: block; position: relative;' : ''} }
		${bleed ? `.frame { position: absolute; left: ${padding}px; top: ${padding}px; width: ${innerW}px; height: ${innerH}px; }` : ''}
		.frame { background: #fff; border: 1px solid #e2e8f0; border-radius: ${phone ? 44 : 20}px; box-shadow: 0 40px 80px -30px rgba(15, 23, 42, 0.35), 0 12px 24px -12px rgba(15, 23, 42, 0.18); overflow: hidden; display: flex; flex-direction: column; ${phone ? 'border: 10px solid #0f172a;' : ''} }
		.bar { align-items: center; border-bottom: 1px solid #e2e8f0; display: flex; gap: 8px; height: 44px; padding: 0 16px; flex-shrink: 0; }
		.bar span { background: #cbd5e1; border-radius: 50%; display: inline-block; height: 11px; width: 11px; }
		.bar span:first-child { background: ${ACCENT}; }
		.bar .url { background: #eef2f7; border-radius: 999px; color: #475569; font-size: 12px; margin-left: 12px; padding: 4px 12px; }
		.clip { width: ${innerW}px; height: ${innerH - (bar ? 44 : 0)}px; overflow: hidden; }
		.clip img { display: block; }
		img { display: block; }
	</style></head><body><div class="frame">${bar ? `<div class="bar"><span></span><span></span><span></span><div class="url">${comp.url || 'yoursite.com/web/guest/home?p_l_mode=edit'}</div></div>` : ''}${media}</div></body></html>`;
}

const MARKETPLACE = [
	{caption: 'Accessibility findings inside the page editor, mapped to the fragment and editable to fix', layers: {base: 'editor-draft.png', overlay: 'editor-draft-panel.png', overlayCrop: 0.6}, name: '01-editor-draft'},
	{caption: 'Published tab: the public page audited as an anonymous visitor, results mapped back to your draft', layers: {base: 'editor-published.png', overlay: 'editor-published-panel.png', overlayCrop: 0.6}, name: '02-published'},
	{caption: 'Site scans from the Page Tree: every page scanned in light and dark, with its score next to its name', name: '03-page-tree', src: 'editor-site.png'},
	{caption: 'CMS content editor: every rich text field checked before it reaches a page', name: '04-cms-editor', src: 'content-cms.png'},
	{caption: 'Web Content editor: rich text fields of any structure, description included', name: '05-web-content', src: 'content-webcontent.png'},
	{caption: 'Blogs editor: the entry body checked as the author writes it', name: '06-blogs', src: 'content-blogs.png'},
	{caption: 'Optional publish gate in the CMS: critical issues hold the Publish button', name: '07-publish-gate', src: 'publish-gate.png'},
	{caption: 'Per-site Accessibility Settings decide what is on, with no code', crop: {x: 0, y: 0, w: 0.75, h: 0.7}, name: '08-settings', src: 'settings.png'},
	{bleed: true, caption: 'Accessibility Report fragment: score, issues by impact, trend, pages, rules, fragments, themes and style books', crop: {x: 0, y: 0, w: 1, h: 1}, name: '09-report', src: 'report-cards.png'},
	{caption: 'The report is responsive and switches between light and dark results', name: '10-report-mobile', phone: true, src: 'report-mobile.png', width: 760},
].map((c) => ({height: 1080, padding: 72, width: 1920, ...c, out: path.resolve('marketplace/storefront')}));

const browser = await chromium.launch();
for (const comp of [...COMPOSITIONS, ...MARKETPLACE]) {
	const page = await browser.newPage({deviceScaleFactor: 2, viewport: {height: comp.height, width: comp.width}});
	await page.setContent(html(comp), {waitUntil: 'load'});
	await page.waitForTimeout(300);
	const png = path.join(comp.out || out, `${comp.name}.png`);
	await page.screenshot({path: png});
	await page.close();
	if (comp.out) {
		console.log('composed', comp.name);
		continue;
	}
	try {
		execFileSync('cwebp', ['-quiet', '-q', '84', png, '-o', png.replace(/\.png$/, '.webp')]);
	}
	catch {
		console.warn('cwebp not available, PNG only for', comp.name);
	}
	console.log('composed', comp.name);
}
const icon = await browser.newPage({deviceScaleFactor: 1, viewport: {height: 1024, width: 1024}});
await icon.setContent(`<!doctype html><html><body style="margin:0;background:transparent">
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
	<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f97316"/><stop offset="1" stop-color="#c2410c"/></linearGradient></defs>
	<rect width="1024" height="1024" rx="224" fill="url(#g)"/>
	<g fill="none" stroke="#fff" stroke-width="64" stroke-linecap="round" stroke-linejoin="round">
		<circle cx="512" cy="236" r="62" fill="#fff" stroke="none"/>
		<path d="M292 372h440M512 372v220M512 592l-132 232M512 592l132 232"/>
	</g>
	<circle cx="776" cy="776" r="150" fill="#0f172a"/>
	<path d="M708 780l44 44 92-100" fill="none" stroke="#fb923c" stroke-width="40" stroke-linecap="round" stroke-linejoin="round"/>
</svg></body></html>`);
await icon.screenshot({omitBackground: true, path: path.resolve('marketplace/icon-1024.png')});
await icon.close();
console.log('composed icon-1024');
await browser.close();
