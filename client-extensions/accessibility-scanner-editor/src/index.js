/**
 * Loader. This is the only script every page pays for: it decides whether the
 * scanner is needed (page editor, or `?accessibilityScan=1` on a rendered page) and
 * only then injects the full bundle with axe-core.
 */

const SCANNER_FILE = __SCANNER_FILE__;

(function () {
	if (window.__lfrAccessibilityScannerLoader) {
		return;
	}
	window.__lfrAccessibilityScannerLoader = true;

	const script = document.currentScript;
	const base = script?.src ? script.src.replace(/[^/]*$/, '') : '';

	function load() {
		if (document.querySelector('script[data-lfr-accessibility-scanner]')) {
			return;
		}
		const el = document.createElement('script');
		el.src = base + SCANNER_FILE;
		el.async = true;
		el.dataset.lfrAccessibilityScanner = 'true';
		if (window.Liferay?.CSP?.nonce) {
			el.setAttribute('nonce', window.Liferay.CSP.nonce);
		}
		document.body.appendChild(el);
	}

	function check() {
		// Hidden frame opened by the panel to audit the published page: load the
		// scanner right away, whatever the URL ends up being after redirects.
		if (window.name === 'lfr-accessibility-published-scan') {
			load();
			return true;
		}
		const params = new URLSearchParams(window.location.search);
		if (params.get('p_l_mode') === 'edit' || params.has('accessibilityScan')) {
			load();
			return true;
		}
		if (document.querySelector('.page-editor')) {
			load();
			return true;
		}
		return false;
	}

	if (check()) {
		return;
	}

	// The content page editor mounts asynchronously; watch briefly for it.
	const observer = new MutationObserver(() => {
		if (check()) {
			observer.disconnect();
		}
	});
	observer.observe(document.documentElement, {childList: true, subtree: true});
	setTimeout(() => observer.disconnect(), 15000);

	// SennaJS navigation into the editor happens without a page load.
	if (window.Liferay?.on) {
		window.Liferay.on('endNavigate', () => setTimeout(check, 0));
	}
})();
