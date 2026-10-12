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
