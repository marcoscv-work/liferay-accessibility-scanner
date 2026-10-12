import axe from 'axe-core';

import {LIFERAY_RULES_SPEC, LIFERAY_RULE_COUNT} from './rules/index.js';
import {resolveContext} from './liferay-context.js';

let configured = false;

const EDITOR_CHROME = [
	'.page-editor__topper__bar',
	'.page-editor__drop-zone',
	'.page-editor__sidebar',
	'.page-editor__toolbar',
	'.page-editor__floating-toolbar',
	'.page-editor__editable-floating-toolbar',
	'.page-editor__layout-viewport__resizer',
	'.control-menu-container',
	'.portlet-topper',
	'.lfr-accessibility-scanner',
];

export const ENGINE_VERSION = axe.version;
export {LIFERAY_RULE_COUNT};

function configure() {
	if (configured) {
		return;
	}
	axe.configure(LIFERAY_RULES_SPEC);
	configured = true;
}

function wcagTags(tags) {
	return tags
		.filter((tag) => /^wcag\d{3,4}$/.test(tag))
		.map((tag) => {
			const digits = tag.replace('wcag', '');
			return digits.length === 3
				? `${digits[0]}.${digits[1]}.${digits[2]}`
				: `${digits[0]}.${digits[1]}.${digits.slice(2)}`;
		});
}

function toFindings(results, needsReview) {
	const findings = [];
	for (const rule of results) {
		const source = rule.tags.includes('liferay') ? 'axe-liferay' : 'axe';
		for (const node of rule.nodes) {
			const element = node.element || null;
			const context = resolveContext(element);
			const checks = [...node.any, ...node.all, ...node.none];
			findings.push({
				context,
				description: rule.description,
				element,
				help: rule.help,
				helpUrl: rule.helpUrl,
				html: node.html,
				impact: node.impact || rule.impact || 'moderate',
				message: checks.map((c) => c.message).filter(Boolean).join(' '),
				needsReview,
				ruleId: rule.id,
				selector: Array.isArray(node.target) ? node.target.join(' ') : String(node.target),
				source,
				wcag: wcagTags(rule.tags),
			});
		}
	}
	return findings;
}

/**
 * Runs axe-core plus the Liferay ruleset against `root` and returns a flat,
 * normalized list of findings with their Liferay authoring context resolved.
 */
/**
 * The page editor marks every fragment's content with aria-hidden="true" so
 * that keyboard users interact with the toppers instead. axe skips anything
 * hidden from assistive technology, which would hide the whole page from the
 * audit, so the attribute is lifted while the scan runs and restored after.
 */
function unhideFragments(root) {
	const hidden = [
		...root.querySelectorAll('.page-editor__fragment-content[aria-hidden="true"]'),
	];
	hidden.forEach((el) => el.removeAttribute('aria-hidden'));
	return () => hidden.forEach((el) => el.setAttribute('aria-hidden', 'true'));
}

export async function runScan(root) {
	configure();

	const restore = unhideFragments(root);
	let results;
	try {
		results = await axe.run(
		{exclude: EDITOR_CHROME.map((s) => [s]), include: [root]},
		{
			elementRef: true,
			resultTypes: ['violations', 'incomplete'],
			runOnly: {
				type: 'tag',
				values: [
					'wcag2a',
					'wcag2aa',
					'wcag21a',
					'wcag21aa',
					'wcag22aa',
					'best-practice',
					'liferay',
				],
			},
		}
		);
	}
	finally {
		restore();
	}

	const findings = [
		...toFindings(results.violations, false),
		...toFindings(results.incomplete, true),
	];

	return {
		engineVersion: axe.version,
		findings,
		timestamp: results.timestamp,
		url: results.url,
	};
}

/*
 * Rules that depend on page styling or page structure. Rich text content is
 * audited unstyled and out of its page, so these would only add noise there.
 */
const CONTENT_DISABLED_RULES = [
	'bypass',
	'color-contrast',
	'color-contrast-enhanced',
	'document-title',
	'html-has-lang',
	'landmark-one-main',
	'link-in-text-block',
	'page-has-heading-one',
	'region',
	'liferay-single-h1',
	'liferay-placeholder-text',
	'liferay-link-destination',
];

const STRIPPED_ELEMENTS = 'script, style, link, meta, base, object, embed';

/** Parses author HTML without running it: no scripts, no handlers, no remote frames. */
function inertFragment(html) {
	const template = document.createElement('template');
	template.innerHTML = html;
	template.content.querySelectorAll(STRIPPED_ELEMENTS).forEach((el) => el.remove());
	template.content.querySelectorAll('*').forEach((el) => {
		[...el.attributes].forEach((attr) => {
			if (/^on/i.test(attr.name) || (/^(href|src|action|formaction)$/i.test(attr.name) && /^\s*javascript:/i.test(attr.value))) {
				el.removeAttribute(attr.name);
			}
		});
		if (el.tagName === 'IFRAME') {
			el.removeAttribute('src');
			el.removeAttribute('srcdoc');
		}
	});
	return template.content;
}

function contentFinding(field, {description, help, impact, message, ruleId, wcag}) {
	return {
		context: {fragmentElement: field.element, fragmentName: field.label},
		description,
		element: null,
		help,
		helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html',
		html: '',
		impact,
		message,
		needsReview: false,
		ruleId,
		selector: '',
		source: 'model',
		wcag,
	};
}

/**
 * Audits the HTML of every rich text field of a content editor: each field is
 * rendered inert in an off-screen sandbox and checked on its own, so heading
 * order and duplicate link texts are judged per field, as authors write them.
 */
export async function runContentScan(adapter) {
	configure();

	const fields = adapter.fields(adapter.root);
	const sandbox = document.createElement('div');
	sandbox.className = 'lfr-accessibility-sandbox';
	sandbox.setAttribute('lang', document.documentElement.lang || 'en');
	sandbox.style.cssText = 'position:absolute;left:-20000px;top:0;width:900px;';
	document.body.appendChild(sandbox);

	const findings = [];
	try {
		for (const field of fields) {
			const section = document.createElement('section');
			section.appendChild(inertFragment(field.html));
			sandbox.appendChild(section);

			const results = await axe.run(
				{include: [section]},
				{
					elementRef: true,
					resultTypes: ['violations', 'incomplete'],
					rules: Object.fromEntries(CONTENT_DISABLED_RULES.map((id) => [id, {enabled: false}])),
					runOnly: {
						type: 'tag',
						values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice', 'liferay'],
					},
				}
			);
			const fieldFindings = [...toFindings(results.violations, false), ...toFindings(results.incomplete, true)];
			fieldFindings.forEach((f) => {
				// The sandbox node is gone after the scan; point at the field instead.
				f.element = null;
				f.context = {fragmentElement: field.element, fragmentName: field.label};
			});
			findings.push(...fieldFindings);

			// The page title is the h1; content that adds its own breaks the outline.
			if (section.querySelector('h1')) {
				findings.push(
					contentFinding(field, {
						description: 'The page title already renders as the level 1 heading, so content headings should start at level 2',
						help: 'Heading level 1 inside the content',
						impact: 'moderate',
						message: 'Change the heading to level 2 (Heading 2 in the editor toolbar).',
						ruleId: 'liferay-content-h1',
						wcag: ['1.3.1'],
					})
				);
			}
		}
	}
	finally {
		sandbox.remove();
	}

	findings.push(...adapter.structuredFindings(adapter.root));

	return {
		engineVersion: axe.version,
		fieldCount: fields.length,
		findings,
		timestamp: new Date().toISOString(),
		url: window.location.href,
	};
}
