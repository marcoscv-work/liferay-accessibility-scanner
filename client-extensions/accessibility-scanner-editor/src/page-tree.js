import {t} from './i18n.js';
import {latestScan} from './site-scan.js';
import {canCreateScans, loadSettings} from './settings.js';

/**
 * Site scans live where all pages are listed: the Page Tree of the product
 * menu. This adds an Accessibility button to the tree header (next to Add
 * Page and Configure Pages) that opens the drawer on the site view, and a
 * score sticker next to every page scanned in the latest site scan.
 *
 * The tree is a React component without extension points, so both are put
 * back by a MutationObserver whenever the tree re-renders.
 */

const HEADER_SELECTOR = '.pages-tree .page-type-selector';
const ITEM_SELECTOR = '.pages-tree .treeview-link';

const TREE_CSS = `
html:not(#__):not(#___) .cadmin .lfr-accessibility-scanner__tree-score {
	font-size: 0.625rem;
	font-weight: 700;
	height: 1.5rem;
	line-height: 1.5rem;
	width: 1.5rem;
}
`;

function escapeHtml(value) {
	return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function accessibilityIcon() {
	const spritemap = window.Liferay?.Icons?.spritemap || `${window.themeDisplay?.getPathThemeImages?.() || ''}/clay/icons.svg`;
	return `<svg class="lexicon-icon lexicon-icon-accessibility" focusable="false" role="presentation"><use href="${spritemap}#accessibility"></use></svg>`;
}

function stickerClass(score) {
	if (score >= 90) {
		return 'sticker-outline-3';
	}
	if (score >= 50) {
		return 'sticker-outline-2';
	}
	return 'sticker-outline-4';
}

function pathOf(url) {
	try {
		return new URL(url, window.location.origin).pathname.replace(/\/$/, '');
	}
	catch {
		return '';
	}
}

export class PageTreeIntegration {
	constructor({openSite}) {
		this.openSite = openSite;
		this.style = document.createElement('style');
		this.style.textContent = TREE_CSS;
		if (window.Liferay?.CSP?.nonce) {
			this.style.setAttribute('nonce', window.Liferay.CSP.nonce);
		}
		document.head.appendChild(this.style);
		this.groupId = window.Liferay?.ThemeDisplay?.getScopeGroupId?.();
		this.scores = new Map();
		this.allowed = null;
		this.observer = new MutationObserver(() => this.decorate());
		this.observer.observe(document.body, {childList: true, subtree: true});
		this.onScanned = () => this.refreshScores();
		document.addEventListener('lfr-accessibility-scanner:site-scanned', this.onScanned);
		this.decorate();
	}

	async isAllowed() {
		if (this.allowed === null) {
			this.allowed = (async () => {
				const settings = await loadSettings(this.groupId);
				return !settings.disableSiteScan && (await canCreateScans(this.groupId));
			})();
		}
		return this.allowed;
	}

	/** After a site scan: reload the scores and repaint the stickers. */
	async refreshScores() {
		await this.loadScores();
		document.querySelectorAll('.lfr-accessibility-scanner__tree-score').forEach((el) => el.remove());
		this.insertScores();
	}

	async loadScores() {
		try {
			const [latest] = await latestScan(this.groupId);
			this.scores = new Map();
			for (const page of latest?.accessibilityScanPages || []) {
				const key = pathOf(page.url) || page.friendlyUrl;
				const entry = this.scores.get(key) || {passes: [], score: 100, violations: 0};
				const scheme = /·\s*(light|dark)\b/.exec(page.experience || '')?.[1];
				entry.passes.push(scheme ? `${scheme} ${page.score}` : String(page.score));
				// Several color scheme passes per page: show the worst one.
				entry.score = Math.min(entry.score, page.score ?? 0);
				entry.violations = Math.max(entry.violations, page.violations ?? 0);
				this.scores.set(key, entry);
			}
			this.latest = latest || null;
		}
		catch {
			this.scores = new Map();
		}
	}

	async decorate() {
		if (this.decorating || !document.querySelector(HEADER_SELECTOR)) {
			return;
		}
		const groupId = window.Liferay?.ThemeDisplay?.getScopeGroupId?.();
		if (groupId !== this.groupId) {
			this.groupId = groupId;
			this.allowed = null;
			this.scoresLoaded = false;
			document.querySelectorAll('.lfr-accessibility-scanner__tree-item, .lfr-accessibility-scanner__tree-score').forEach((el) => el.remove());
		}
		this.decorating = true;
		try {
			if (!(await this.isAllowed())) {
				return;
			}
			this.insertButton();
			if (!this.scoresLoaded) {
				this.scoresLoaded = true;
				await this.loadScores();
			}
			this.insertScores();
		}
		finally {
			this.decorating = false;
		}
	}

	insertButton() {
		const header = document.querySelector(HEADER_SELECTOR);
		if (!header || header.querySelector('.lfr-accessibility-scanner__tree-button')) {
			return;
		}
		const column = document.createElement('div');
		column.className = 'autofit-col ml-2 cadmin lfr-accessibility-scanner__tree-item';
		const label = t('scan-site-tree');
		column.innerHTML = `<button aria-label="${escapeHtml(label)}" class="btn btn-monospaced btn-sm btn-unstyled lfr-accessibility-scanner__tree-button" title="${escapeHtml(label)}" type="button">${accessibilityIcon()}</button>`;
		// Between Add Page and Configure Pages.
		const addPage = header.querySelector('.flex-fill');
		if (addPage) {
			addPage.insertAdjacentElement('afterend', column);
		}
		else {
			header.appendChild(column);
		}
		column.querySelector('button').addEventListener('click', () => this.openSite());
	}

	insertScores() {
		if (!this.scores.size) {
			return;
		}
		document.querySelectorAll(ITEM_SELECTOR).forEach((item) => {
			const link = item.querySelector('a[href]');
			if (!link || item.querySelector('.lfr-accessibility-scanner__tree-score')) {
				return;
			}
			const entry = this.scores.get(pathOf(link.href));
			if (!entry) {
				return;
			}
			// Name the color scheme passes only when there is more than one.
			const text = entry.passes.length > 1 ? t('tree-score', entry.score, entry.violations, entry.passes.join(', ')) : t('tree-score-single', entry.score, entry.violations);
			const sticker = document.createElement('span');
			sticker.className = `sticker sticker-circle sticker-sm ${stickerClass(entry.score)} ml-2 flex-shrink-0 lfr-accessibility-scanner__tree-score`;
			sticker.setAttribute('role', 'img');
			sticker.setAttribute('aria-label', text);
			sticker.title = text;
			sticker.textContent = String(entry.score);
			link.insertAdjacentElement('afterend', sticker);
		});
	}

	destroy() {
		this.observer.disconnect();
		document.removeEventListener('lfr-accessibility-scanner:site-scanned', this.onScanned);
		document.querySelectorAll('.lfr-accessibility-scanner__tree-item, .lfr-accessibility-scanner__tree-score').forEach((el) => el.remove());
		this.style.remove();
	}
}

export const PAGE_TREE_SELECTOR = HEADER_SELECTOR;
