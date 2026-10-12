import {ScannerPanel} from './panel.js';
import {runScan} from './runner.js';

/**
 * Boot. Waits for the content page editor to mount and attaches the panel to
 * it. Outside the editor the scanner only activates on demand with
 * `?accessibilityScan=1` in the URL, so the script stays inert for visitors.
 */

const EDITOR_SELECTOR = '.page-editor';
const MAX_WAIT_MS = 30000;

function viewRoot() {
	return (
		document.querySelector('#main-content') ||
		document.querySelector('#content') ||
		document.body
	);
}

function waitFor(selector, timeout) {
	return new Promise((resolve) => {
		const existing = document.querySelector(selector);
		if (existing) {
			resolve(existing);
			return;
		}
		const observer = new MutationObserver(() => {
			const el = document.querySelector(selector);
			if (el) {
				observer.disconnect();
				resolve(el);
			}
		});
		observer.observe(document.documentElement, {childList: true, subtree: true});
		setTimeout(() => {
			observer.disconnect();
			resolve(null);
		}, timeout);
	});
}

function wantsPanel() {
	const params = new URLSearchParams(window.location.search);
	if (params.get('p_l_mode') === 'edit' || document.querySelector(EDITOR_SELECTOR)) {
		return 'editor';
	}
	if (params.has('accessibilityScan')) {
		return 'view';
	}
	return null;
}

async function mountFor(mode) {
	if (mode === 'editor') {
		const editor = await waitFor(EDITOR_SELECTOR, MAX_WAIT_MS);
		if (editor && wantsPanel() === 'editor') {
			window.__lfrAccessibilityScannerPanel = new ScannerPanel(editor, {mode: 'editor'});
		}
		return;
	}
	if (mode === 'view') {
		window.__lfrAccessibilityScannerPanel = new ScannerPanel(viewRoot(), {mode: 'view'});
	}
}

/**
 * Liferay navigates between pages with SennaJS, so leaving the editor does not
 * reload the document. On every navigation the panel is torn down when the new
 * page does not want it, and created when it does.
 */
function syncWithNavigation() {
	const mode = wantsPanel();
	const panel = window.__lfrAccessibilityScannerPanel;
	if (panel && !panel.destroyed && (!mode || panel.mode !== mode)) {
		panel.destroy();
		window.__lfrAccessibilityScannerPanel = null;
	}
	if (mode && (!window.__lfrAccessibilityScannerPanel || window.__lfrAccessibilityScannerPanel.destroyed)) {
		mountFor(mode);
	}
}

async function start() {
	if (window.__lfrAccessibilityScanner) {
		return;
	}
	window.__lfrAccessibilityScanner = true;

	// Embedded mode: the panel loads the published page in a hidden same-origin
	// frame named like this and calls runScan through the frame's window.
	if (window.name === 'lfr-accessibility-published-scan') {
		window.__lfrAccessibilityRunScan = (root) => runScan(root || viewRoot());
		return;
	}

	await mountFor(wantsPanel());

	if (window.Liferay?.on) {
		window.Liferay.on('endNavigate', () => setTimeout(syncWithNavigation, 0));
	}
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', start);
}
else {
	start();
}
