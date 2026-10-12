import {t} from './i18n.js';
import {contextLabel, groupKey} from './liferay-context.js';
import {MODEL_CHECK_COUNT, runModelScan} from './model.js';
import {latestScan, probeSiteDarkScheme, runSiteScan} from './site-scan.js';
import {ENGINE_VERSION, LIFERAY_RULE_COUNT, runContentScan, runScan} from './runner.js';
import {PANEL_CSS} from './styles.js';

const IMPACTS = ['critical', 'serious', 'moderate', 'minor'];

/* Clay outline stickers: light background, 1px border and dark text, like
   labels (4 red, 5 orange, default blue, 9 gray, 2 yellow). */
const IMPACT_STICKER_CLASS = {
	critical: 'sticker-outline-4',
	minor: 'sticker-outline-9',
	moderate: 'sticker-outline',
	review: 'sticker-outline-2',
	serious: 'sticker-outline-5',
};

/** Compact impact marker: a colored circle with the initial and a tooltip. */
function impactSticker(impact, needsReview) {
	const key = needsReview ? 'review' : impact;
	const text = needsReview ? t('needs-review') : t(impact);
	return `<span aria-label="${escapeHtml(text)}" class="sticker sticker-circle sticker-sm ${IMPACT_STICKER_CLASS[key] || 'sticker-secondary'} lfr-accessibility-scanner__impact" role="img" title="${escapeHtml(text)}">${escapeHtml(t(`initial-${key}`))}</span>`;
}

const FRAME_NAME = 'lfr-accessibility-published-scan';
const STALE_SCAN_DAYS = 14;

function spritemap() {
	try {
		return (
			window.Liferay?.Icons?.spritemap ||
			window.Liferay?.ThemeDisplay?.getPathThemeSpritemap?.() ||
			''
		);
	}
	catch {
		return '';
	}
}

function icon(symbol, extraClass = '') {
	return `<svg aria-hidden="true" class="lexicon-icon lexicon-icon-${symbol} ${extraClass}" focusable="false" role="presentation"><use href="${spritemap()}#${symbol}"></use></svg>`;
}

function escapeHtml(value) {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function nonce() {
	return window.Liferay?.CSP?.nonce || '';
}

const EDITOR_ATTRIBUTES = new Set([
	'contenteditable',
	'data-tooltip-floating',
	'draggable',
	'spellcheck',
	'tabindex',
]);

/* Attributes an author recognizes; classes and ids are developer noise here. */
const KEPT_ATTRIBUTES = ['alt', 'href', 'src', 'aria-label', 'role', 'target'];

/**
 * One-line, inspector-like summary of the offending element: tag plus the
 * attributes an author recognizes, without the classes and attributes the
 * page editor adds while editing.
 */
function summarizeElement(html) {
	let el;
	try {
		el = new DOMParser().parseFromString(html, 'text/html').body.firstElementChild;
	}
	catch {
		el = null;
	}
	if (!el) {
		return html.replace(/\s+/g, ' ').trim();
	}
	const parts = [el.tagName.toLowerCase()];
	for (const name of KEPT_ATTRIBUTES) {
		if (!el.hasAttribute(name) || EDITOR_ATTRIBUTES.has(name)) {
			continue;
		}
		let value = el.getAttribute(name).trim();
		if (!value && name !== 'alt') {
			continue;
		}
		if (name === 'src' || name === 'href') {
			value = value.length > 40 ? '…' + value.slice(-37) : value;
		}
		parts.push(`${name}="${value}"`);
	}
	const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
	let summary = `<${parts.join(' ')}>`;
	if (text) {
		summary += text.length > 40 ? `${text.slice(0, 40)}…` : text;
	}
	return summary;
}

function sortFindings(findings) {
	return findings.sort(
		(a, b) =>
			Number(a.needsReview) - Number(b.needsReview) ||
			IMPACTS.indexOf(a.impact) - IMPACTS.indexOf(b.impact)
	);
}

/**
 * Resolves the public URL of the page being edited. The editor runs on the
 * draft layout, whose classPK points at the published layout.
 */
async function resolvePublishedURL() {
	const td = window.Liferay?.ThemeDisplay;
	if (!td) {
		return null;
	}
	const relative = td.getLayoutRelativeURL();
	const sitePath = relative.slice(0, relative.lastIndexOf('/'));
	const auth = window.Liferay?.authToken ? `?p_auth=${window.Liferay.authToken}` : '';

	const draft = await fetch(
		`/api/jsonws/layout/get-layout/plid/${td.getPlid()}${auth}`,
		{credentials: 'include'}
	).then((r) => r.json());

	if (!draft.classPK || draft.classPK === '0') {
		return null;
	}

	const published = await fetch(
		`/api/jsonws/layout/get-layout/plid/${draft.classPK}${auth}`,
		{credentials: 'include'}
	).then((r) => r.json());

	if (!published.friendlyURL) {
		return null;
	}
	return `${window.location.origin}${sitePath}${published.friendlyURL}`;
}

export class ScannerPanel {
	constructor(root, {adapter = null, allowPublished = true, allowSite = true, mode, settings = {}}) {
		this.root = root;
		this.mode = mode;
		this.adapter = adapter;
		this.settings = settings;
		this.allowPublished = allowPublished;
		this.allowSite = allowSite;
		this.source = mode === 'editor' ? 'editor' : mode === 'content' ? 'content' : 'published';
		this.reports = {content: null, editor: null, published: null, site: null};
		this.filter = 'all';
		this.highlighted = [];
		this.open = false;
		this.scanning = false;
		this.panelId = 'lfr-accessibility-scanner-panel';

		this.mount();
	}

	get findings() {
		return this.reports[this.source]?.findings || [];
	}

	mount() {
		const style = document.createElement('style');
		style.textContent = PANEL_CSS;
		if (nonce()) {
			style.setAttribute('nonce', nonce());
		}
		document.head.appendChild(style);
		this.styleElement = style;

		this.host = document.createElement('div');
		// lfr-tooltip-scope lets Liferay's tooltip support turn every title into a Clay tooltip.
		this.host.className = 'cadmin lfr-tooltip-scope lfr-accessibility-scanner';
		this.host.setAttribute('dir', document.documentElement.dir || 'ltr');

		const tab = (source, active) =>
			`<li class="nav-item" role="none"><button aria-selected="${active}" class="nav-link ${active ? 'active' : ''} btn btn-unstyled" data-source="${source}" role="tab" type="button">${escapeHtml(t(`source-${source}`))}</button></li>`;
		const sources = [];
		if (this.mode === 'content') {
			sources.push('content');
		}
		else {
			if (this.mode === 'editor') {
				sources.push('editor');
			}
			if (this.allowPublished || this.mode !== 'editor') {
				sources.push('published');
			}
			if (this.allowSite) {
				sources.push('site');
			}
		}
		// A single source needs no tab strip.
		const sourceTabs = sources.length > 1
			? `
			<ul class="nav nav-tabs flex-shrink-0 px-3" data-sources role="tablist">
				${sources.map((source, i) => tab(source, i === 0)).join('')}
			</ul>`
			: '';

		this.host.innerHTML = `
			<button aria-controls="${this.panelId}" aria-expanded="false" class="btn btn-primary btn-monospaced btn-lg lfr-accessibility-scanner__fab" title="${escapeHtml(t('toggle'))}" type="button">
				${icon('accessibility')}
				<span aria-hidden="true" class="lfr-accessibility-scanner__fab-check">${icon('check-circle-full')}</span>
				<span class="sr-only">${escapeHtml(t('toggle'))}</span>
				<span class="badge badge-danger badge-pill" data-count hidden></span>
			</button>
			<div aria-labelledby="${this.panelId}-title" class="lfr-accessibility-scanner__panel" hidden id="${this.panelId}" role="dialog">
				<header class="align-items-center d-flex flex-shrink-0 justify-content-between my-3 pl-3 pr-2 lfr-accessibility-scanner__header">
					<h2 class="flex-grow-1 mb-0 mr-1 text-3" id="${this.panelId}-title">${escapeHtml(t('title'))}</h2>
					<button class="btn btn-monospaced btn-sm btn-unstyled" data-action="rescan" data-tooltip-align="bottom" title="${escapeHtml(t('rescan'))}" type="button">${icon('reload')}<span class="sr-only">${escapeHtml(t('rescan'))}</span></button>
					<button class="btn btn-monospaced btn-sm btn-unstyled" data-action="close" data-tooltip-align="bottom" title="${escapeHtml(t('close'))}" type="button">${icon('times')}<span class="sr-only">${escapeHtml(t('close'))}</span></button>
				</header>
				${sourceTabs}
				<span aria-live="polite" class="sr-only" data-live></span>
				<div class="flex-grow-1 lfr-accessibility-scanner__results" data-results></div>
				<div class="flex-shrink-0 px-3 py-2 text-2 text-secondary lfr-accessibility-scanner__footer" data-engine></div>
			</div>
		`;
		document.body.appendChild(this.host);

		this.fab = this.host.querySelector('.lfr-accessibility-scanner__fab');
		this.panel = this.host.querySelector('.lfr-accessibility-scanner__panel');
		this.countBadge = this.host.querySelector('[data-count]');
		this.live = this.host.querySelector('[data-live]');
		this.results = this.host.querySelector('[data-results]');
		this.engine = this.host.querySelector('[data-engine]');

		this.fab.addEventListener('click', () => this.toggle());
		this.host.addEventListener('click', (event) => this.onClick(event));
		this.host.addEventListener('change', (event) => {
			if (event.target.matches('[data-filter-select]')) {
				this.filter = event.target.value;
				this.render();
			}
			if (event.target.matches('[data-scheme-select]')) {
				this.siteScheme = event.target.value;
			}
		});
		this.host.addEventListener('keydown', (event) => {
			if (event.key === 'Escape' && this.open) {
				this.toggle(false);
				(this.toolbarButton || this.fab).focus();
			}
		});
		window.addEventListener('resize', () => this.updateTop());
		if (this.mode === 'editor') {
			const observer = new MutationObserver(() => this.updateTop());
			observer.observe(this.root.parentElement || document.body, {
				childList: true,
				subtree: false,
			});
		}

		this.engine.textContent = t('axe-source', ENGINE_VERSION, LIFERAY_RULE_COUNT, MODEL_CHECK_COUNT);

		if (this.mode === 'editor') {
			this.dockToolbarButton();
		}
		if (this.mode === 'content') {
			this.host.classList.add('lfr-accessibility-scanner--content');
			this.hookPublish();
		}
	}

	/**
	 * CMS publishing: the content editor fires `contentEditor:validateForm`
	 * before submitting and any listener can cancel it. When the site blocks
	 * publishing with critical issues, the first click is held, the content is
	 * scanned and the publish goes ahead only when nothing critical is left.
	 */
	hookPublish() {
		if (this.adapter?.kind !== 'cms' || !this.settings.blockPublishOnCritical || !window.Liferay?.on) {
			return;
		}
		this.publishHandle = window.Liferay.on('contentEditor:validateForm', (payload) => {
			const event = payload?.event;
			if (this.destroyed || !event || event.defaultPrevented) {
				return;
			}
			if (this.publishApproved) {
				this.publishApproved = false;
				return;
			}
			event.preventDefault();
			const trigger = event.submitter || event.target?.closest?.('button, [type="submit"]') || null;
			this.checkBeforePublish(trigger);
		});
	}

	async checkBeforePublish(trigger) {
		this.toast(t('publish-checking'), 'info');
		this.source = 'content';
		this.reports.content = null;
		await this.scan();
		const critical = (this.reports.content?.findings || []).filter((f) => !f.needsReview && f.impact === 'critical');
		if (critical.length) {
			this.filter = 'critical';
			this.render();
			this.toggle(true);
			this.toast(t('publish-blocked', critical.length), 'danger');
			return;
		}
		this.publishApproved = true;
		if (trigger?.isConnected) {
			trigger.click();
		}
		else if (this.adapter.root.requestSubmit) {
			this.adapter.root.requestSubmit();
		}
	}

	toast(message, type) {
		if (window.Liferay?.Util?.openToast) {
			window.Liferay.Util.openToast({message, type});
		}
	}

	/**
	 * In the editor the toggle lives in the toolbar, next to the viewport
	 * buttons, as one more `btn-monospaced`. The toolbar is React-rendered and
	 * can repaint, so a MutationObserver puts the button back when it is gone.
	 * The floating button stays as a fallback when the toolbar is not there.
	 */
	dockToolbarButton() {
		const insert = () => {
			if (this.toolbarButton?.isConnected) {
				return true;
			}
			const nav = document.querySelector('.page-editor__toolbar .middle.navbar-nav');
			const viewportItem = nav?.querySelector('.nav-item');
			if (!nav || !viewportItem) {
				return false;
			}
			const item = document.createElement('li');
			item.className = 'nav-item lfr-accessibility-scanner__toolbar-item';
			item.setAttribute('role', 'presentation');
			item.innerHTML = `<button aria-controls="${this.panelId}" aria-expanded="${this.open}" aria-pressed="${this.open}" class="btn btn-monospaced btn-sm btn-secondary ml-3 lfr-accessibility-scanner__toolbar-button ${this.open ? 'active' : ''}" title="${escapeHtml(t('toggle'))}" type="button">${icon('accessibility')}<span class="sr-only">${escapeHtml(t('toggle'))}</span><span class="badge badge-danger badge-pill" data-count hidden></span></button>`;
			viewportItem.insertAdjacentElement('afterend', item);
			this.toolbarButton = item.querySelector('button');
			this.toolbarButton.addEventListener('click', () => this.toggle());
			this.host.classList.add('lfr-accessibility-scanner--docked');
			this.syncToggles();
			return true;
		};

		insert();
		const toolbar = document.querySelector('.page-editor__toolbar') || document.body;
		this.toolbarObserver = new MutationObserver(() => insert());
		this.toolbarObserver.observe(toolbar, {childList: true, subtree: true});
	}

	/** Mirrors open state and the counter on every toggle (toolbar and floating). */
	syncToggles() {
		const count = this.countBadge.textContent;
		const hidden = this.countBadge.hidden;
		for (const button of [this.fab, this.toolbarButton]) {
			if (!button) {
				continue;
			}
			button.setAttribute('aria-expanded', String(this.open));
			if (button === this.toolbarButton) {
				button.setAttribute('aria-pressed', String(this.open));
				button.classList.toggle('active', this.open);
			}
			const badge = button.querySelector('[data-count]');
			if (badge) {
				badge.textContent = count;
				badge.hidden = hidden;
			}
		}
	}

	/**
	 * The drawer sits exactly where the editor's own configuration sidebar
	 * lives (same top and width, flush right), so it covers that sidebar and
	 * nothing else. Outside the editor it hangs below the control menu.
	 */
	updateTop() {
		const sidebar = document.querySelector(
			'.page-editor__item-configuration-sidebar, [aria-label="Configuration Panel"]'
		);
		const bar =
			this.adapter?.toolbar?.() ||
			document.querySelector('.page-editor__toolbar') ||
			document.querySelector('.control-menu-container');

		let top = bar ? bar.getBoundingClientRect().bottom : 0;
		let width = 320;
		if (sidebar) {
			const rect = sidebar.getBoundingClientRect();
			if (rect.width > 0) {
				width = rect.width;
			}
			if (rect.top > 0) {
				top = rect.top;
			}
			if (!this.sidebarObserver && window.ResizeObserver) {
				this.sidebarObserver = new ResizeObserver(() => this.updateTop());
				this.sidebarObserver.observe(sidebar);
			}
		}
		this.host.style.setProperty('--lfr-accessibility-top', `${Math.round(Math.max(0, top))}px`);
		this.host.style.setProperty('--lfr-accessibility-width', `${Math.round(width)}px`);
	}

	/** Removes everything the panel added to the page (SPA navigation away). */
	destroy() {
		this.siteAbort?.abort();
		this.publishHandle?.detach?.();
		this.toolbarObserver?.disconnect();
		this.sidebarObserver?.disconnect();
		this.frame?.remove();
		this.toolbarButton?.closest('.lfr-accessibility-scanner__toolbar-item')?.remove();
		this.styleElement?.remove();
		this.host?.remove();
		document.querySelectorAll('iframe[name="lfr-accessibility-published-scan"], iframe[name="lfr-accessibility-theme-probe"]').forEach((f) => f.remove());
		this.destroyed = true;
	}

	toggle(force) {
		this.open = typeof force === 'boolean' ? force : !this.open;
		this.updateTop();
		this.panel.hidden = !this.open;
		this.syncToggles();
		if (this.open) {
			if (this.allowSite) {
				this.checkStaleScan();
			}
			if (this.source === 'site') {
				this.renderSite();
			}
			else if (!this.reports[this.source]) {
				this.scan();
			}
			this.panel.querySelector('[data-action="close"]').focus();
		}
		else {
			this.clearHighlight();
		}
	}

	setSource(source) {
		if (source === this.source) {
			return;
		}
		this.source = source;
		this.filter = 'all';
		this.clearHighlight();
		this.host.querySelectorAll('[data-source]').forEach((tab) => {
			const active = tab.dataset.source === source;
			tab.classList.toggle('active', active);
			tab.setAttribute('aria-selected', String(active));
		});
		if (source === 'site') {
			this.renderSite();
			return;
		}
		if (this.reports[source]) {
			this.render();
		}
		else {
			this.scan();
		}
	}

	/** One-line nudge on the other tabs when the site has never been scanned or the scan is old. */
	async checkStaleScan() {
		if (this.staleChecked) {
			return;
		}
		this.staleChecked = true;
		try {
			const [latest] = await latestScan(window.Liferay?.ThemeDisplay?.getScopeGroupId?.());
			if (!latest) {
				this.staleNotice = t('never-scanned');
			}
			else {
				const ageDays = Math.floor((Date.now() - new Date(latest.startDate).getTime()) / 86400000);
				this.staleNotice = ageDays >= STALE_SCAN_DAYS ? t('stale-scan', ageDays) : null;
			}
		}
		catch {
			this.staleNotice = null;
		}
		if (this.staleNotice && this.reports[this.source] && this.source !== 'site') {
			this.render();
		}
	}

	/* ---------- Site tab ---------- */

	async renderSite() {
		const groupId = window.Liferay?.ThemeDisplay?.getScopeGroupId?.();
		if (!this.darkScheme && !this.darkProbe) {
			this.darkProbe = probeSiteDarkScheme()
				.catch(() => ({capable: false, evidence: {dataColorScheme: 0, lightDark: 0, prefersColorScheme: 0}, supported: false}))
				.then((result) => {
					this.darkScheme = result;
					if (this.source === 'site' && !this.siteScanning) {
						this.renderSite();
					}
				});
		}
		this.live.textContent = '';
		this.results.innerHTML = `<div class="px-3 pt-3 lfr-accessibility-scanner__site"><p class="text-3 text-secondary">${escapeHtml(t('loading'))}</p></div>`;
		let scans = [];
		try {
			scans = await latestScan(groupId);
		}
		catch (error) {
			scans = [];
			this.siteError = error.message;
		}
		if (this.source !== 'site') {
			return;
		}
		this.results.innerHTML = this.siteMarkup(scans[0], scans[1]);
	}

	siteMarkup(latest, previous, progress, result) {
		const probe = this.darkScheme;
		const darkSupported = Boolean(probe?.supported);
		const scheme = darkSupported ? this.siteScheme || 'light' : 'light';
		let schemeHint = '';
		if (!probe) {
			schemeHint = `<p class="mb-2 text-2 text-secondary">${escapeHtml(t('probing-theme'))}</p>`;
		}
		else if (!darkSupported) {
			const key = probe.styleBookOnly ? 'no-dark-scheme-style-book-only' : probe.capable ? 'dark-capable-only' : 'no-dark-scheme';
			schemeHint = `<p class="mb-2 text-2 text-secondary">${escapeHtml(t(key))}</p>`;
		}
		else {
			const themes = (probe.sources || []).filter((x) => x.kind === 'theme').map((x) => x.name);
			const where = themes.length ? t('dark-source-theme', themes.join(', ')) : t('dark-source-other', (probe.sources || []).filter((x) => x.kind !== 'style-book').map((x) => x.name).join(', '));
			schemeHint = `<p class="mb-2 text-2 text-secondary">${escapeHtml(t('dark-scheme-found', where))} ${escapeHtml(t('dark-per-page'))}</p>`;
		}
		// No selector when the theme has no dark scheme: there is nothing to pick.
		const schemeSelect = !darkSupported
			? schemeHint
			: `${schemeHint}
				<div class="form-group form-group-sm mb-2">
					<label class="text-2" for="${this.panelId}-scheme">${escapeHtml(t('color-scheme'))}</label>
					<select class="form-control form-control-sm" data-scheme-select id="${this.panelId}-scheme" ${progress ? 'disabled' : ''}>
						${['light', 'dark', 'both'].map((v) => `<option value="${v}" ${scheme === v ? 'selected' : ''}>${escapeHtml(t(`scheme-${v}`))}</option>`).join('')}
					</select>
				</div>`;
		const button = `${schemeSelect}<button class="btn btn-primary btn-sm btn-block" data-action="scan-site" ${progress ? 'disabled' : ''} type="button">${escapeHtml(t('scan-site'))}</button>`;
		const cancel = progress
			? `<button class="btn btn-secondary btn-sm btn-block mt-2" data-action="cancel-site" type="button">${escapeHtml(t('cancel'))}</button>`
			: '';
		let summary = '';
		if (progress) {
			const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
			summary = `
				<p class="mb-1 text-3">${escapeHtml(t('scanning-page', progress.done + (progress.status === 'scanning' ? 1 : 0), progress.total, progress.page || ''))}</p>
				<div aria-valuemax="100" aria-valuemin="0" aria-valuenow="${pct}" class="progress mb-3" role="progressbar"><div class="progress-bar" style="width: ${pct}%"></div></div>`;
		}
		else if (latest) {
			const delta = previous ? latest.violations - previous.violations : null;
			const when = new Date(latest.startDate).toLocaleString();
			const ageDays = Math.floor((Date.now() - new Date(latest.startDate).getTime()) / 86400000);
			const stale = ageDays >= STALE_SCAN_DAYS ? `<div class="alert alert-warning p-2 text-2 mb-2" role="status">${escapeHtml(t('stale-scan', ageDays))}</div>` : '';
			summary = `${stale}
				<p class="mb-1 text-3">${escapeHtml(t('last-scan', when))}</p>
				<div class="d-flex align-items-baseline mb-1">
					<span class="h2 mb-0 mr-2">${latest.score ?? 0}</span>
					<span class="text-2 text-secondary">${escapeHtml(t('score-of-100'))}</span>
					${delta !== null ? `<span class="label ${delta > 0 ? 'label-danger' : delta < 0 ? 'label-success' : 'label-secondary'} ml-auto">${delta > 0 ? '+' : ''}${delta} ${escapeHtml(t('vs-previous'))}</span>` : ''}
				</div>
				<p class="mb-3 text-2 text-secondary">${escapeHtml(t('scan-totals', latest.violations ?? 0, latest.pagesScanned ?? 0, latest.needsReview ?? 0))} · ${escapeHtml(latest.trigger || '')} · ${escapeHtml(latest.scanStatus || '')}</p>
				${result?.lightOnlyPages ? `<p class="mb-3 text-2 text-secondary">${escapeHtml(t('light-only-pages', result.lightOnlyPages))}</p>` : ''}`;
		}
		else {
			summary = `<p class="mb-3 text-3 text-secondary">${escapeHtml(this.siteError ? t('site-error', this.siteError) : t('no-scans'))}</p>`;
		}

		const pages = result?.results || latest?.accessibilityScanPages || [];
		const rows = [...pages]
			.sort((a, b) => (b.violations ?? -1) - (a.violations ?? -1))
			.map((p) => {
				const editURL = `${p.url || ''}${p.url?.includes('?') ? '&' : '?'}p_l_mode=edit`;
				return `
				<li class="list-group-item px-0 py-2">
					<div class="autofit-row autofit-row-center">
						<div class="autofit-col autofit-col-expand">
							<p class="mb-0 text-3 font-weight-semi-bold text-truncate" title="${escapeHtml(p.friendlyUrl || p.friendly || '')}">${escapeHtml(p.pageTitle || p.title || p.friendlyUrl || p.friendly)}</p>
							<p class="mb-0 text-2 text-secondary">${p.error ? escapeHtml(p.error) : `${escapeHtml(t('violations-count', p.violations ?? 0))} · ${escapeHtml(t('score-short', p.score ?? 0))}${(p.visibility || p.experience) === 'authenticated' ? ` · ${escapeHtml(t('authenticated'))}` : ''}${p.themeName ? `<br>${escapeHtml(t('theme-label', p.themeName))}${p.styleBookName ? ` · ${escapeHtml(t('style-book-label', p.styleBookName))}` : ''}` : ''}`}</p>
						</div>
						<div class="autofit-col">
							${p.url ? `<a class="btn btn-xs btn-secondary btn-monospaced" href="${escapeHtml(editURL)}" rel="noopener" target="_blank" title="${escapeHtml(t('open-in-editor'))}">${icon('pencil')}<span class="sr-only">${escapeHtml(t('open-in-editor'))}</span></a>` : ''}
						</div>
					</div>
				</li>`;
			})
			.join('');

		return `
			<div class="px-3 pt-3 lfr-accessibility-scanner__site">
				${summary}
				${button}
				${cancel}
				<p class="mt-3 mb-2 text-2 text-secondary">${escapeHtml(t('site-scan-note'))}</p>
				${rows ? `<ul class="list-group list-group-flush mb-0">${rows}</ul>` : ''}
			</div>`;
	}

	async scanSite() {
		if (this.siteScanning) {
			return;
		}
		this.siteScanning = true;
		this.siteAbort = new AbortController();
		const groupId = window.Liferay?.ThemeDisplay?.getScopeGroupId?.();
		let previous = null;
		try {
			previous = (await latestScan(groupId))[0] || null;
		}
		catch {
			previous = null;
		}
		const onProgress = (progress) => {
			if (this.source === 'site') {
				this.results.innerHTML = this.siteMarkup(null, null, progress);
			}
			this.live.textContent = t('scanning-page', progress.done, progress.total, progress.page || '');
		};
		try {
			const schemes = this.siteScheme === 'both' ? ['light', 'dark'] : [this.siteScheme || 'light'];
			const result = await runSiteScan({onProgress, schemes, signal: this.siteAbort.signal});
			this.reports.site = result;
			const latest = {
				accessibilityScanPages: result.results,
				needsReview: result.needsReview,
				pagesScanned: result.pagesScanned,
				scanStatus: result.scanStatus,
				score: result.score,
				startDate: result.startDate,
				trigger: 'browser',
				violations: result.violations,
			};
			if (this.source === 'site') {
				this.results.innerHTML = this.siteMarkup(latest, previous, null, result);
			}
			this.live.textContent = t('scan-totals', result.violations, result.pagesScanned, result.needsReview);
		}
		catch (error) {
			console.error('[accessibility-scanner]', error);
			if (this.source === 'site') {
				this.siteError = error.message;
				this.results.innerHTML = this.siteMarkup(null, null);
			}
		}
		finally {
			this.siteScanning = false;
		}
	}

	async scan() {
		if (this.scanning) {
			return;
		}
		if (this.source === 'site') {
			this.renderSite();
			return;
		}
		const source = this.source;
		this.scanning = true;
		this.clearHighlight();
		this.live.textContent = t('scanning');
		this.results.innerHTML = `<p class="px-3 pt-3 text-3 text-secondary">${escapeHtml(t('scanning'))}</p><div class="py-4 text-center"><span aria-hidden="true" class="loading-animation loading-animation-sm"></span></div>`;
		try {
			let report;
			if (source === 'content') {
				report = await runContentScan(this.adapter);
			}
			else if (source === 'published' && this.mode === 'editor') {
				report = await this.scanPublished();
			}
			else {
				report = await runScan(this.root);
			}
			// Page-level content checks (translations, alt texts, style book tokens)
			// join the DOM findings; they come from the APIs, so they are best effort.
			if (source !== 'content') try {
				const model = await runModelScan({mode: this.mode, pageLevelOnly: true});
				model.findings.forEach((f) => {
					f.context.fragmentElement = this.findDraftItem(f.context.itemId);
				});
				report.findings = report.findings.concat(model.findings);
				report.notes = [...(report.notes || []), ...(model.notes || [])];
			}
			catch (error) {
				console.warn('[accessibility-scanner] content checks skipped', error);
			}
			report.findings = sortFindings(report.findings);
			this.reports[source] = report;
			document.dispatchEvent(
				new CustomEvent('lfr-accessibility-scanner:report', {
					detail: {...report, source},
				})
			);
		}
		catch (error) {
			console.error('[accessibility-scanner]', error);
			this.reports[source] = null;
			this.errors = this.errors || {};
			this.errors[source] =
				source === 'published'
					? t('published-error', error.message || error)
					: String(error.message || error);
		}
		finally {
			this.scanning = false;
		}

		// The user may have switched tabs while this scan was running.
		if (this.source === 'site') {
			this.renderSite();
			return;
		}
		if (this.source !== source && !this.reports[this.source]) {
			this.scan();
			return;
		}
		if (this.reports[this.source]) {
			this.render();
		}
		else {
			const message = this.errors?.[this.source] || '';
			this.live.textContent = message;
			this.results.innerHTML = `<p class="px-3 pt-3 text-3 text-secondary">${escapeHtml(message)}</p>`;
		}
	}

	/**
	 * Loads the public URL of the page in a hidden same-origin frame and runs
	 * the scanner against the real published DOM. The global loader running
	 * inside the frame recognizes the frame name and loads the scanner itself,
	 * so this survives redirects inside the frame; injecting the script is only
	 * a fallback for pages without the loader. Findings are then mapped back to
	 * the draft fragments through the layout item id.
	 */
	async scanPublished() {
		const url = await resolvePublishedURL();
		if (!url) {
			throw new Error(t('published-unavailable'));
		}
		const head = await fetch(url, {credentials: 'include', method: 'HEAD'});
		if (!head.ok) {
			throw new Error(`${t('published-unavailable')} (HTTP ${head.status})`);
		}

		this.frame?.remove();
		const frame = document.createElement('iframe');
		frame.name = FRAME_NAME;
		frame.setAttribute('aria-hidden', 'true');
		frame.setAttribute('tabindex', '-1');
		frame.setAttribute('title', t('source-published'));
		frame.style.cssText =
			'position:fixed;left:-20000px;top:0;width:1280px;height:900px;border:0;visibility:visible;';
		this.frame = frame;

		// Set src before attaching, otherwise the first "load" is about:blank.
		frame.src = url;
		document.body.appendChild(frame);

		const scannerSrc = document.querySelector('script[data-lfr-accessibility-scanner]')?.src;
		let win = null;
		let injectedInto = null;
		const deadline = Date.now() + 45000;
		while (Date.now() < deadline) {
			win = frame.contentWindow;
			const doc = frame.contentDocument;
			if (win && typeof win.__lfrAccessibilityRunScan === 'function') {
				break;
			}
			if (
				doc &&
				doc.readyState === 'complete' &&
				doc.body &&
				doc !== injectedInto &&
				scannerSrc &&
				!win.__lfrAccessibilityScannerLoader
			) {
				const script = doc.createElement('script');
				script.src = scannerSrc;
				doc.body.appendChild(script);
				injectedInto = doc;
			}
			await new Promise((r) => setTimeout(r, 150));
		}
		if (!win || typeof win.__lfrAccessibilityRunScan !== 'function') {
			throw new Error('scanner did not start in the frame');
		}

		const report = await win.__lfrAccessibilityRunScan();
		report.publishedURL = url;
		report.findings.forEach((finding) => {
			finding.publishedElement = finding.element;
			finding.element = null;
			finding.context.fragmentElement = this.findDraftItem(finding.context.itemId);
		});
		return report;
	}

	/**
	 * Draft and published layouts share item ids, except for pages created
	 * through the API with explicit codes, where the draft often carries a
	 * "-draft" suffix. Try both.
	 */
	findDraftItem(itemId) {
		if (!itemId) {
			return null;
		}
		for (const candidate of [itemId, `${itemId}-draft`]) {
			const el = this.root.querySelector(
				`.lfr-layout-structure-item-${CSS.escape(candidate)}`
			);
			if (el) {
				return el;
			}
		}
		return null;
	}

	visibleFindings() {
		if (this.filter === 'all') {
			return this.findings;
		}
		if (this.filter === 'needs-review') {
			return this.findings.filter((f) => f.needsReview);
		}
		return this.findings.filter((f) => f.impact === this.filter && !f.needsReview);
	}

	render() {
		const report = this.reports[this.source];
		const violations = this.findings.filter((f) => !f.needsReview);
		const fragments = new Set(violations.map((f) => groupKey(f.context)));

		const primary = this.reports[this.mode === 'editor' ? 'editor' : this.mode === 'content' ? 'content' : 'published'];
		const primaryViolations = (primary?.findings || []).filter((f) => !f.needsReview);
		const count = primary ? primaryViolations.length : violations.length;
		this.countBadge.textContent = String(count);
		this.countBadge.hidden = count === 0;
		this.syncToggles();

		let summary;
		if (this.source === 'content') {
			const fields = new Set(violations.map((f) => f.context.fragmentName));
			summary = !report?.fieldCount && !violations.length
				? t('no-content-fields')
				: violations.length === 1
					? t('content-summary-one')
					: violations.length
						? fields.size === 1
							? t('content-summary-one-field', violations.length)
							: t('content-summary', violations.length, fields.size)
						: t('no-content-issues');
		}
		else {
			summary = violations.length ? t('summary', violations.length, fragments.size) : t('no-issues');
		}
		if (this.source === 'published' && report?.publishedURL) {
			summary += ` ${t('published-note')}`;
		}
		if (report?.notes?.length) {
			summary += ` ${report.notes.join('. ')}.`;
		}
		this.live.textContent = summary;

		const counts = {'all': this.findings.length, 'needs-review': 0};
		IMPACTS.forEach((i) => (counts[i] = 0));
		this.findings.forEach((f) => {
			if (f.needsReview) {
				counts['needs-review'] += 1;
			}
			else {
				counts[f.impact] += 1;
			}
		});

		const filterOptions = ['all', ...IMPACTS, 'needs-review']
			.filter((key) => key === 'all' || counts[key] > 0)
			.map(
				(key) =>
					`<option value="${key}" ${this.filter === key ? 'selected' : ''}>${escapeHtml(t(key))} (${counts[key]})</option>`
			)
			.join('');

		const staleNotice = this.staleNotice
			? `<p class="mb-2 text-2"><a href="#" data-action="go-site">${escapeHtml(this.staleNotice)}</a></p>`
			: '';
		const summaryBlock = `
			<div class="px-3 pt-3 pb-2 lfr-accessibility-scanner__summary">
				${staleNotice}
				<p class="mb-2 text-3 text-secondary">${escapeHtml(summary)}</p>
				${this.findings.length ? `<select aria-label="${escapeHtml(t('filter'))}" class="form-control form-control-sm" data-filter-select>${filterOptions}</select>` : ''}
			</div>`;

		const visible = this.visibleFindings();
		if (!visible.length) {
			this.results.innerHTML = summaryBlock;
			return;
		}

		const byRule = new Map();
		visible.forEach((f) => {
			if (!byRule.has(f.ruleId)) {
				byRule.set(f.ruleId, []);
			}
			byRule.get(f.ruleId).push(f);
		});

		let index = 0;
		this.results.innerHTML = summaryBlock + [...byRule.entries()]
			.map(([ruleId, items], ruleIndex) => {
				const first = items[0];
				const bodyId = `${this.panelId}-${this.source}-rule-${ruleIndex}`;
				const expanded = ruleIndex === 0;
				const meta = [
					first.source === 'axe-liferay'
						? t('liferay-rule')
						: first.source === 'model'
							? t('content-check')
							: 'axe-core',
					first.wcag.length ? `WCAG ${first.wcag.join(', ')}` : null,
				].filter(Boolean);
				return `
				<section class="lfr-accessibility-scanner__rule">
					<button aria-controls="${bodyId}" aria-expanded="${expanded}" class="btn btn-unstyled d-flex align-items-start px-3 py-2 text-left w-100 lfr-accessibility-scanner__rule-header" data-action="collapse" type="button">
						${impactSticker(first.impact, first.needsReview)}
						<span class="flex-grow-1 text-3 font-weight-semi-bold">${escapeHtml(first.help)}</span>
						<span class="badge badge-pill badge-secondary ml-2 mt-1 flex-shrink-0">${items.length}</span>
						<span class="ml-2 mt-1 flex-shrink-0 text-secondary">${icon(expanded ? 'angle-down' : 'angle-right')}</span>
					</button>
					<div class="px-3 pb-3 lfr-accessibility-scanner__rule-body" id="${bodyId}" ${expanded ? '' : 'hidden'}>
						<p class="mb-2 text-2 text-secondary">
							${escapeHtml(first.description)}.
							<span class="d-block mt-1">${meta.map(escapeHtml).join(' · ')} · <a href="${escapeHtml(first.helpUrl)}" rel="noopener noreferrer" target="_blank">${escapeHtml(t('open-rule-help'))}<span class="sr-only"> (${escapeHtml(t('new-tab'))})</span></a></span>
						</p>
						<ul class="list-group list-group-flush mb-0">
							${items
								.map((f) => {
									const i = index++;
									f.index = i;
									const canHighlight = Boolean(f.element || f.context.fragmentElement);
									const canSelect = (this.mode === 'editor' || this.mode === 'content') && Boolean(f.context.fragmentElement);
									const selectLabel = this.mode === 'content' ? t('go-to-field') : t('select-in-editor');
									return `
							<li class="list-group-item px-0 py-2">
								<div class="autofit-row autofit-row-center mb-1">
									<div class="autofit-col autofit-col-expand">
										<p class="mb-0 text-3 font-weight-semi-bold text-truncate" title="${escapeHtml(contextLabel(f.context, t))}">${escapeHtml(contextLabel(f.context, t))}</p>
									</div>
									<div class="autofit-col">
										<div class="btn-group" role="group">
											<button class="btn btn-xs btn-secondary btn-monospaced" data-action="highlight" data-index="${i}" ${canHighlight ? '' : 'disabled'} title="${escapeHtml(canHighlight ? t('highlight') : t('not-in-editor'))}" type="button">${icon('view')}<span class="sr-only">${escapeHtml(t('highlight'))}</span></button>
											${this.mode === 'editor' || this.mode === 'content' ? `<button class="btn btn-xs btn-secondary btn-monospaced" data-action="select" data-index="${i}" ${canSelect ? '' : 'disabled'} title="${escapeHtml(selectLabel)}" type="button">${icon('select-from-list')}<span class="sr-only">${escapeHtml(selectLabel)}</span></button>` : ''}
										</div>
									</div>
								</div>
								${f.message ? `<p class="mb-1 text-2 text-secondary">${escapeHtml(f.message)}</p>` : ''}
								${f.html ? `<code class="lfr-accessibility-scanner__element" title="${escapeHtml(f.html)}">${escapeHtml(summarizeElement(f.html))}</code>` : ''}
							</li>`;
								})
								.join('')}
						</ul>
					</div>
				</section>`;
			})
			.join('');
	}

	onClick(event) {
		const button = event.target.closest('button, [data-action]');
		if (!button || button.disabled) {
			return;
		}
		if (button.dataset.filter) {
			this.filter = button.dataset.filter;
			this.render();
			return;
		}
		if (button.dataset.source) {
			this.setSource(button.dataset.source);
			return;
		}
		switch (button.dataset.action) {
			case 'close':
				this.toggle(false);
				(this.toolbarButton || this.fab).focus();
				break;
			case 'rescan':
				if (this.source === 'site') {
					this.renderSite();
					break;
				}
				this.reports[this.source] = null;
				this.scan();
				break;
			case 'scan-site':
				this.scanSite();
				break;
			case 'go-site':
				event.preventDefault();
				this.setSource('site');
				break;
			case 'cancel-site':
				this.siteAbort?.abort();
				break;
			case 'collapse': {
				const expanded = button.getAttribute('aria-expanded') === 'true';
				button.setAttribute('aria-expanded', String(!expanded));
				document.getElementById(button.getAttribute('aria-controls')).hidden = expanded;
				const chevron = button.querySelector('.lexicon-icon');
				chevron.outerHTML = icon(expanded ? 'angle-right' : 'angle-down');
				break;
			}
			case 'highlight':
				this.highlight(this.findings[Number(button.dataset.index)]);
				break;
			case 'select':
				this.select(this.findings[Number(button.dataset.index)]);
				break;
			default:
				break;
		}
	}

	clearHighlight() {
		this.highlighted.forEach((el) =>
			el.classList.remove(
				'lfr-accessibility-scanner__highlight',
				'lfr-accessibility-scanner__highlight--fragment'
			)
		);
		this.highlighted = [];
	}

	highlight(finding) {
		this.clearHighlight();
		let element = finding.element;
		if (element && !element.isConnected) {
			try {
				element = this.root.querySelector(finding.selector);
			}
			catch {
				element = null;
			}
		}
		if (element) {
			element.classList.add('lfr-accessibility-scanner__highlight');
			this.highlighted.push(element);
			element.scrollIntoView({behavior: 'smooth', block: 'center'});
		}
		const fragment = finding.context.fragmentElement;
		if (fragment && fragment !== element) {
			fragment.classList.add('lfr-accessibility-scanner__highlight--fragment');
			this.highlighted.push(fragment);
			if (!element) {
				fragment.scrollIntoView({behavior: 'smooth', block: 'center'});
			}
		}
	}

	select(finding) {
		this.highlight(finding);
		const fragment = finding.context.fragmentElement;
		if (!fragment) {
			return;
		}
		if (this.mode === 'content') {
			// Put the caret in the field's editor: CKEditor 4 iframe, CKEditor 5 or inline.
			const frame = fragment.querySelector('iframe.cke_wysiwyg_frame');
			const editable = frame?.contentDocument?.body || fragment.querySelector('.ck-editor__editable, [contenteditable="true"]');
			editable?.focus?.();
			return;
		}
		const topper = fragment.closest('.page-editor__topper') || fragment;
		topper.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}));
	}
}
