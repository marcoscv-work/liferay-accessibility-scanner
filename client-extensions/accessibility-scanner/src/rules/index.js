/**
 * Liferay-aware axe-core rules.
 *
 * Every rule is tagged "liferay" so the runner can tell them apart from the
 * stock axe ruleset, and carries the WCAG success criterion it relates to.
 * Checks return true (pass), false (fail) or undefined (needs human review).
 */

const HELP_BASE = 'https://github.com/marcoscv-work/liferay-accessibility-scanner/blob/master/docs/rules.md#';

/** Default texts shipped by the OOTB basic component fragments. */
const PLACEHOLDER_TEXTS = [
	'heading example',
	'go somewhere',
	'button',
	'a paragraph is a self-contained unit of a discourse in writing dealing with a particular point or idea. paragraphs are usually an expected part of formal writing, used to organize longer prose.',
	'card title example',
	'this is an example of quick text to fill the body of the card with some content in order to present it properly in page. we hope you like it.',
	'lorem ipsum',
	'example title',
	'example subtitle',
	'example text',
	'link example',
	'tab title',
	'accordion title',
	'add your title here',
	'add your text here',
];

const GENERIC_LINK_TEXTS = new Set([
	'click here',
	'here',
	'more',
	'read more',
	'learn more',
	'see more',
	'view more',
	'details',
	'link',
	'this page',
	'continue',
	'go',
	'pincha aquí',
	'pulsa aquí',
	'haz clic aquí',
	'aquí',
	'más',
	'leer más',
	'ver más',
	'saber más',
	'más información',
	'más info',
	'detalles',
	'enlace',
	'continuar',
	'ir',
]);

const NEW_TAB_HINT =
	/(new (tab|window)|opens? in (a )?new|external|nueva (pestaña|ventana)|se abre en|externo)/i;

const FILENAME_ALT =
	/(\.(png|jpe?g|gif|svg|webp|avif|bmp|tiff?)$)|^(img|image|imagen|photo|foto|picture|dsc|dscn|screenshot|captura)[\s_-]?\d*$/i;

function normalizeText(node) {
	const label =
		node.getAttribute('aria-label') ||
		(node.hasAttribute('aria-labelledby')
			? [...node.getAttribute('aria-labelledby').split(/\s+/)]
					.map((id) => document.getElementById(id)?.textContent || '')
					.join(' ')
			: '') ||
		node.textContent ||
		'';
	return label
		.replace(/\s+/g, ' ')
		.replace(/[\s.…!:>»→]+$/g, '')
		.trim()
		.toLowerCase();
}

function scanRoot(node) {
	return node.closest('.page-editor') || document.body;
}

/* Editor furniture rendered inside the scanned root. Never list an ancestor of
   the root here (.lfr-tooltip-scope wraps the whole editor, for instance). */
function isEditorChrome(node) {
	return Boolean(
		node.closest(
			'.page-editor__topper__bar, .page-editor__drop-zone, .portlet-topper, .lfr-accessibility-scanner'
		)
	);
}

export const LIFERAY_RULES_SPEC = {
	checks: [
		{
			evaluate(node) {
				const text = normalizeText(node);
				if (!text) {
					return true;
				}
				const hit = PLACEHOLDER_TEXTS.some(
					(p) => text === p || (p.length > 30 && text.startsWith(p.slice(0, 40)))
				);
				if (hit) {
					this.data({text: text.slice(0, 60)});
				}
				return !hit;
			},
			id: 'liferay-placeholder-text-check',
			metadata: {
				impact: 'serious',
				messages: {
					fail: 'The editable still shows the fragment default text',
					pass: 'The editable has author content',
				},
			},
		},
		{
			evaluate(node) {
				if (isEditorChrome(node)) {
					return true;
				}
				if (
					node.getAttribute('role') === 'button' ||
					node.hasAttribute('data-toggle') ||
					node.hasAttribute('data-bs-toggle') ||
					node.hasAttribute('data-senna-off') === false && node.closest('[data-lfr-editable-type="action"]')
				) {
					return true;
				}
				const href = (node.getAttribute('href') || '').trim();
				return !(
					href === '' ||
					href === '#' ||
					/^javascript:/i.test(href)
				);
			},
			id: 'liferay-link-destination-check',
			metadata: {
				impact: 'serious',
				messages: {
					fail: 'The link has no destination configured (empty, "#" or javascript:)',
					pass: 'The link has a destination',
				},
			},
		},
		{
			evaluate(node) {
				const root = scanRoot(node);
				const headings = [...root.querySelectorAll('h1')].filter(
					(h) => !isEditorChrome(h)
				);
				this.data({count: headings.length});
				return headings.length <= 1;
			},
			id: 'liferay-single-h1-check',
			metadata: {
				impact: 'moderate',
				messages: {
					fail: 'The page renders more than one <h1>',
					pass: 'The page has a single <h1>',
				},
			},
		},
		{
			evaluate(node) {
				const text = normalizeText(node);
				if (!text || !GENERIC_LINK_TEXTS.has(text)) {
					return true;
				}
				this.data({text});
				return false;
			},
			id: 'liferay-generic-link-text-check',
			metadata: {
				impact: 'moderate',
				messages: {
					fail: 'The link or button text does not describe its purpose out of context',
					pass: 'The link or button text is descriptive',
				},
			},
		},
		{
			evaluate(node) {
				const text = normalizeText(node);
				if (!text) {
					return true;
				}
				const href = node.getAttribute('href');
				const root = scanRoot(node);
				const twins = [...root.querySelectorAll('a[href]')].filter(
					(other) =>
						other !== node &&
						!isEditorChrome(other) &&
						normalizeText(other) === text &&
						other.getAttribute('href') !== href
				);
				if (twins.length) {
					this.data({count: twins.length + 1, text});
				}
				return twins.length === 0;
			},
			id: 'liferay-duplicate-link-text-check',
			metadata: {
				impact: 'moderate',
				messages: {
					fail: 'Several links share the same text but point to different destinations',
					pass: 'Links with the same text share a destination',
				},
			},
		},
		{
			evaluate(node) {
				const hint =
					(node.getAttribute('aria-label') || '') +
					' ' +
					(node.getAttribute('title') || '') +
					' ' +
					(node.textContent || '');
				return NEW_TAB_HINT.test(hint) || Boolean(node.querySelector('.lexicon-icon[data-icon="shortcut"], .sr-only'));
			},
			id: 'liferay-new-tab-warning-check',
			metadata: {
				impact: 'moderate',
				messages: {
					fail: 'The link opens a new tab without telling the user',
					pass: 'The link announces that it opens a new tab',
				},
			},
		},
		{
			evaluate(node) {
				const alt = (node.getAttribute('alt') || '').trim();
				if (!alt) {
					return true;
				}
				const src = node.getAttribute('src') || '';
				const basename = decodeURIComponent(
					src.split('?')[0].split('/').pop() || ''
				).toLowerCase();
				const bad =
					FILENAME_ALT.test(alt) ||
					(basename && alt.toLowerCase() === basename) ||
					(basename && alt.toLowerCase() === basename.replace(/\.[a-z0-9]+$/, ''));
				if (bad) {
					this.data({alt});
				}
				return !bad;
			},
			id: 'liferay-alt-filename-check',
			metadata: {
				impact: 'serious',
				messages: {
					fail: 'The alt text looks like a file name or an automatic label',
					pass: 'The alt text is descriptive',
				},
			},
		},
		{
			evaluate(node) {
				if (node.tagName === 'VIDEO') {
					return node.querySelector('track[kind="captions"], track[kind="subtitles"]')
						? true
						: undefined;
				}
				return undefined;
			},
			id: 'liferay-video-captions-check',
			metadata: {
				impact: 'moderate',
				messages: {
					fail: 'The video has no captions track',
					incomplete: 'Check that the video provides captions and a transcript',
					pass: 'The video declares a captions track',
				},
			},
		},
		{
			evaluate(node) {
				const interval =
					node.getAttribute('data-bs-interval') ??
					node.getAttribute('data-interval');
				const ride =
					node.getAttribute('data-bs-ride') ?? node.getAttribute('data-ride');
				const bootstrapAutoplay =
					(interval !== null && interval !== 'false' && interval !== '0') ||
					ride === 'carousel';
				/* The OOTB Banner Slider fragment advances with setInterval and
				   renders only "Focus slide N" buttons, so it is detected by shape. */
				const liferaySlider =
					node.classList.contains('carousel') &&
					Boolean(node.querySelector('.carousel-navigation')) &&
					Boolean(node.querySelector('.carousel-inner'));
				if (!bootstrapAutoplay && !liferaySlider) {
					return true;
				}
				const pause = node.querySelector(
					'[aria-label*="pause" i], [aria-label*="stop" i], [aria-label*="pausa" i], [aria-label*="detener" i], .carousel-pause, [data-action="pause"], button.pause'
				);
				return Boolean(pause);
			},
			id: 'liferay-carousel-autoplay-check',
			metadata: {
				impact: 'serious',
				messages: {
					fail: 'The slider advances automatically and offers no pause or stop control',
					pass: 'The slider does not autoplay or can be paused',
				},
			},
		},
	],
	rules: [
		{
			any: ['liferay-placeholder-text-check'],
			id: 'liferay-placeholder-text',
			metadata: {
				description: 'Editables must not keep the default text of the fragment',
				help: 'Fragment placeholder text left in the page',
				helpUrl: HELP_BASE + 'liferay-placeholder-text',
			},
			selector: '[data-lfr-editable-id]',
			tags: ['liferay', 'wcag2a', 'wcag131', 'best-practice'],
		},
		{
			any: ['liferay-link-destination-check'],
			id: 'liferay-link-destination',
			metadata: {
				description: 'Links and link buttons must have a destination configured',
				help: 'Link without destination',
				helpUrl: HELP_BASE + 'liferay-link-destination',
			},
			selector: 'a',
			tags: ['liferay', 'wcag2a', 'wcag244'],
		},
		{
			any: ['liferay-single-h1-check'],
			id: 'liferay-single-h1',
			metadata: {
				description: 'A page should expose a single top-level heading',
				help: 'Multiple <h1> headings on the page',
				helpUrl: HELP_BASE + 'liferay-single-h1',
			},
			selector: 'h1',
			tags: ['liferay', 'wcag2a', 'wcag131', 'best-practice'],
		},
		{
			any: ['liferay-generic-link-text-check'],
			id: 'liferay-generic-link-text',
			metadata: {
				description: 'Link and button texts must describe their purpose',
				help: 'Generic link or button text',
				helpUrl: HELP_BASE + 'liferay-generic-link-text',
			},
			selector: 'a[href], button',
			tags: ['liferay', 'wcag2a', 'wcag244'],
		},
		{
			any: ['liferay-duplicate-link-text-check'],
			id: 'liferay-duplicate-link-text',
			metadata: {
				description: 'Links with identical text should lead to the same place',
				help: 'Same link text, different destinations',
				helpUrl: HELP_BASE + 'liferay-duplicate-link-text',
			},
			selector: 'a[href]',
			tags: ['liferay', 'wcag2a', 'wcag244'],
		},
		{
			any: ['liferay-new-tab-warning-check'],
			id: 'liferay-new-tab-warning',
			metadata: {
				description: 'Links that open a new tab must say so',
				help: 'Opens in a new tab without warning',
				helpUrl: HELP_BASE + 'liferay-new-tab-warning',
			},
			selector: 'a[target="_blank"]',
			tags: ['liferay', 'wcag2a', 'wcag322', 'best-practice'],
		},
		{
			any: ['liferay-alt-filename-check'],
			id: 'liferay-alt-filename',
			metadata: {
				description: 'Alternative text must describe the image, not name the file',
				help: 'Alt text is a file name',
				helpUrl: HELP_BASE + 'liferay-alt-filename',
			},
			selector: 'img[alt]',
			tags: ['liferay', 'wcag2a', 'wcag111'],
		},
		{
			any: ['liferay-video-captions-check'],
			id: 'liferay-video-captions',
			metadata: {
				description: 'Videos need captions and a transcript',
				help: 'Video without declared captions',
				helpUrl: HELP_BASE + 'liferay-video-captions',
			},
			selector:
				'video, iframe[src*="youtube.com"], iframe[src*="youtu.be"], iframe[src*="vimeo.com"]',
			tags: ['liferay', 'wcag2a', 'wcag122', 'wcag123'],
		},
		{
			any: ['liferay-carousel-autoplay-check'],
			id: 'liferay-carousel-autoplay',
			metadata: {
				description: 'Auto-advancing sliders must offer a pause or stop control',
				help: 'Slider autoplays without a pause control',
				helpUrl: HELP_BASE + 'liferay-carousel-autoplay',
			},
			selector: '.carousel, [data-bs-ride], [data-ride]',
			tags: ['liferay', 'wcag2a', 'wcag222'],
		},
	],
};

export const LIFERAY_RULE_COUNT = LIFERAY_RULES_SPEC.rules.length;
