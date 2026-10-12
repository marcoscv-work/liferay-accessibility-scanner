/**
 * Site scan: every public page of a site, rendered as an anonymous visitor in
 * Chromium, audited with axe-core plus the same Liferay rules the editor
 * panel uses, and stored in the AccessibilityScan / AccessibilityPage / AccessibilityFinding Objects.
 */

import {createRequire} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {chromium} from 'playwright';

import * as liferay from './liferay.js';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));

const AXE_SOURCE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const RULES_SOURCE = fs.readFileSync(path.join(here, '..', 'build', 'rules.js'), 'utf8');
const CONTEXT_SOURCE = fs.readFileSync(path.join(here, '..', 'build', 'context.js'), 'utf8');

const IMPACT_WEIGHT = {critical: 10, minor: 1, moderate: 2, serious: 5};

const VIEWPORTS = {
	desktop: {height: 900, width: 1280},
	mobile: {height: 800, width: 375},
};

function wcagTags(tags) {
	return tags
		.filter((tag) => /^wcag\d{3,4}$/.test(tag))
		.map((tag) => {
			const d = tag.replace('wcag', '');
			return d.length === 3 ? `${d[0]}.${d[1]}.${d[2]}` : `${d[0]}.${d[1]}.${d.slice(2)}`;
		})
		.join(', ');
}

function score(findings) {
	const penalty = findings
		.filter((f) => !f.needsReview)
		.reduce((sum, f) => sum + (IMPACT_WEIGHT[f.impact] || 1), 0);
	return Math.max(0, 100 - penalty);
}

/** Runs inside the page: axe + Liferay rules, with the Liferay context of every node. */
function auditInPage() {
	const root =
		document.querySelector('#main-content') ||
		document.querySelector('#content') ||
		document.body;
	window.axe.configure(window.LfrAccessibilityRules.LIFERAY_RULES_SPEC);
	return window.axe
		.run(
			{exclude: [['.control-menu-container'], ['.lfr-accessibility-scanner']], include: [root]},
			{
				elementRef: true,
				resultTypes: ['violations', 'incomplete'],
				runOnly: {
					type: 'tag',
					values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice', 'liferay'],
				},
			}
		)
		.then((results) => {
			const out = [];
			const collect = (rules, needsReview) => {
				for (const rule of rules) {
					for (const node of rule.nodes) {
						const context = window.LfrAccessibilityContext.resolveContext(node.element);
						out.push({
							context: {
								editableId: context.editableId,
								fragmentName: context.fragmentName,
								itemId: context.itemId,
								portletId: context.portletId,
							},
							help: rule.help,
							helpUrl: rule.helpUrl,
							html: node.html,
							impact: node.impact || rule.impact || 'moderate',
							message: [...node.any, ...node.all, ...node.none]
								.map((c) => c.message)
								.filter(Boolean)
								.join(' '),
							needsReview,
							ruleId: rule.id,
							selector: Array.isArray(node.target) ? node.target.join(' ') : String(node.target),
							source: rule.tags.includes('liferay') ? 'axe-liferay' : 'axe',
							tags: rule.tags,
						});
					}
				}
			};
			collect(results.violations, false);
			collect(results.incomplete, true);
			return {engine: window.axe.version, findings: out, title: document.title};
		});
}

export async function scanSite({groupId, languageId, log = console.log, trigger = 'manual', viewport = 'desktop'}) {
	const group = await liferay.getGroup(groupId);
	const site = await liferay.getSite(groupId).catch(() => null);
	const siteERC = group.externalReferenceCode;
	const sitePath = `/web${group.friendlyURL}`;
	const language = languageId || (site?.availableLanguages?.[0] || 'en-US').replace('-', '_');
	const locale = language.replace('_', '-');
	const pages = await liferay.listSitePages(siteERC);

	const siteName = site?.name || group.nameCurrentValue || group.descriptiveName || String(groupId);

	log(`site ${siteName} (${groupId}, ${siteERC}): ${pages.length} pages, ${locale}, ${viewport}`);

	const scan = await liferay.createScan(groupId, {
		engineVersion: '',
		languageId: locale,
		needsReview: 0,
		pagesScanned: 0,
		scanStatus: 'running',
		score: 0,
		siteGroupId: String(groupId),
		siteName,
		startDate: new Date().toISOString(),
		trigger,
		viewport,
		violations: 0,
	});

	const browser = await chromium.launch();
	const context = await browser.newContext({
		locale,
		viewport: VIEWPORTS[viewport] || VIEWPORTS.desktop,
	});
	const results = [];
	let engine = '';

	try {
		for (const sitePage of pages) {
			const friendly = sitePage.friendlyUrlPath_i18n?.[locale] || Object.values(sitePage.friendlyUrlPath_i18n || {})[0];
			if (!friendly) {
				continue;
			}
			const url = `${liferay.portalURL()}${sitePath}${friendly}`;
			const page = await context.newPage();
			try {
				const response = await page.goto(url, {timeout: 60000, waitUntil: 'networkidle'});
				if (!response || response.status() >= 400 || page.url().includes('/login')) {
					log(`  skip ${friendly} (${response ? response.status() : 'no response'})`);
					continue;
				}
				await page.addScriptTag({content: AXE_SOURCE});
				await page.addScriptTag({content: RULES_SOURCE});
				await page.addScriptTag({content: CONTEXT_SOURCE});
				const audit = await page.evaluate(auditInPage);
				engine = audit.engine;
				const pageScore = score(audit.findings);
				const violations = audit.findings.filter((f) => !f.needsReview).length;
				const needsReview = audit.findings.length - violations;
				log(`  ${friendly}: ${violations} violations, ${needsReview} to review, score ${pageScore}`);

				const stored = await liferay.createPage(groupId, scan.id, {
					experience: 'DEFAULT',
					friendlyUrl: friendly,
					languageId: locale,
					needsReview,
					pageTitle: sitePage.name_i18n?.[locale] || audit.title || friendly,
					plid: '',
					score: pageScore,
					url,
					violations,
				});
				await liferay.createFindings(
					groupId,
					stored.id,
					audit.findings.map((f) => ({
						editableId: f.context.editableId || '',
						findingStatus: 'open',
						fragmentName: f.context.fragmentName || '',
						help: f.help,
						helpUrl: f.helpUrl,
						html: (f.html || '').slice(0, 4000),
						impact: f.impact,
						itemId: f.context.itemId || '',
						message: (f.message || '').slice(0, 4000),
						needsReview: f.needsReview,
						portletId: f.context.portletId || '',
						ruleId: f.ruleId,
						selector: (f.selector || '').slice(0, 2000),
						source: f.source,
						wcag: wcagTags(f.tags),
					}))
				);
				results.push({friendly, needsReview, score: pageScore, violations});
			}
			catch (error) {
				log(`  error ${friendly}: ${error.message}`);
			}
			finally {
				await page.close();
			}
		}
	}
	finally {
		await browser.close();
	}

	const summary = {
		endDate: new Date().toISOString(),
		engineVersion: engine ? `axe-core ${engine} + Liferay rules` : '',
		needsReview: results.reduce((s, r) => s + r.needsReview, 0),
		pagesScanned: results.length,
		scanStatus: 'completed',
		score: results.length ? Math.round(results.reduce((s, r) => s + r.score, 0) / results.length) : 0,
		violations: results.reduce((s, r) => s + r.violations, 0),
	};
	await liferay.updateScan(scan.id, summary);
	log(`done: ${summary.pagesScanned} pages, ${summary.violations} violations, score ${summary.score} (scan ${scan.id})`);
	return {scanId: scan.id, ...summary, pages: results};
}
