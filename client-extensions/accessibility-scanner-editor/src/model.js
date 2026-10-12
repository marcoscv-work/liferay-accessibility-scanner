/**
 * Model-level checks. These read the page definition, the site and the style
 * book through Liferay's APIs instead of the rendered DOM, so they catch what
 * no DOM scanner can: missing translations, alt texts never set in the editor,
 * library images without a description, style book token pairs that fail
 * contrast, duplicated page titles.
 *
 * Every check returns findings in the same shape as the axe runner.
 */

const HELP_BASE =
	'https://github.com/marcoscv-work/liferay-accessibility-scanner/blob/main/docs/rules.md#';

const RULES = {
	'liferay-model-document-description': {
		description: 'Library images need a description so every page that uses them inherits an alternative text',
		help: 'Library image without description',
		impact: 'moderate',
		wcag: ['1.1.1'],
	},
	'liferay-model-image-alt': {
		description: 'Image editables need an alternative text set in the editor',
		help: 'Image without alternative text in the editor',
		impact: 'serious',
		wcag: ['1.1.1'],
	},
	'liferay-model-page-title': {
		description: 'Each page needs a unique, non-empty title',
		help: 'Duplicated or empty page title',
		impact: 'moderate',
		wcag: ['2.4.2'],
	},
	'liferay-model-token-contrast': {
		description: 'Style book token pairs must meet the minimum contrast ratio; fixing the token fixes every page',
		help: 'Style book tokens with insufficient contrast',
		impact: 'serious',
		wcag: ['1.4.3', '1.4.11'],
	},
	'liferay-model-translations': {
		description: 'Editable texts and alternative texts should be translated into every language of the site',
		help: 'Content not translated into all site languages',
		impact: 'moderate',
		wcag: ['3.1.2'],
	},
};

export const MODEL_CHECK_COUNT = Object.keys(RULES).length;

/* Token pairs: [foreground, background, minimum ratio, what the pair is]. */
const TOKEN_PAIRS = [
	['--body-color', '--body-bg', 4.5, 'text'],
	['--text-muted', '--body-bg', 4.5, 'text'],
	['--link-color', '--body-bg', 4.5, 'text'],
	['--btn-link-color', '--body-bg', 4.5, 'text'],
	['--btn-outline-primary-color', '--body-bg', 4.5, 'text'],
	['--btn-outline-secondary-color', '--body-bg', 4.5, 'text'],
	['--btn-primary-color', '--btn-primary-background-color', 4.5, 'text'],
	['--btn-primary-hover-color', '--btn-primary-hover-background-color', 4.5, 'text'],
	['--btn-secondary-color', '--btn-secondary-background-color', 4.5, 'text'],
	['--btn-secondary-hover-color', '--btn-secondary-hover-background-color', 4.5, 'text'],
	['--btn-primary-background-color', '--body-bg', 3, 'control'],
	['--btn-secondary-border-color', '--btn-secondary-background-color', 3, 'control'],
	['--btn-outline-primary-border-color', '--body-bg', 3, 'control'],
	['--btn-outline-secondary-border-color', '--body-bg', 3, 'control'],
];

function themeDisplay() {
	return window.Liferay?.ThemeDisplay;
}

function authParam() {
	return window.Liferay?.authToken ? `?p_auth=${window.Liferay.authToken}` : '';
}

async function getJSON(url) {
	const response = await fetch(url, {
		credentials: 'include',
		headers: {
			Accept: 'application/json',
			// Avoid 406 when the browser language is not a portal locale.
			'Accept-Language': (window.Liferay?.ThemeDisplay?.getLanguageId?.() || 'en_US').replace('_', '-'),
		},
	});
	if (!response.ok) {
		throw new Error(`${response.status} ${url.split('?')[0]}`);
	}
	return response.json();
}

function finding(ruleId, context, message, extra = {}) {
	const rule = RULES[ruleId];
	return {
		context: {
			editableId: null,
			editableType: null,
			fragmentElement: null,
			fragmentName: null,
			itemId: null,
			portletId: null,
			portletName: null,
			...context,
		},
		description: rule.description,
		element: null,
		help: rule.help,
		helpUrl: HELP_BASE + ruleId,
		html: extra.html || '',
		impact: extra.impact || rule.impact,
		message,
		needsReview: Boolean(extra.needsReview),
		ruleId,
		selector: extra.selector || '',
		source: 'model',
		wcag: rule.wcag,
	};
}

function normalizeLanguage(id) {
	return String(id || '').replace('_', '-');
}

/**
 * Who we are: site, published layout and page codes. The editor runs on the
 * draft layout, whose classPK is the published one.
 */
export async function resolvePageInfo() {
	const td = themeDisplay();
	if (!td) {
		throw new Error('ThemeDisplay unavailable');
	}
	const groupId = td.getScopeGroupId();
	const relative = td.getLayoutRelativeURL();
	const sitePath = relative.slice(0, relative.lastIndexOf('/'));

	const [group, layout] = await Promise.all([
		getJSON(`/api/jsonws/group/get-group/group-id/${groupId}${authParam()}`),
		getJSON(`/api/jsonws/layout/get-layout/plid/${td.getPlid()}${authParam()}`),
	]);

	let published = layout;
	const isDraft = layout.classPK && layout.classPK !== '0';
	if (isDraft) {
		published = await getJSON(
			`/api/jsonws/layout/get-layout/plid/${layout.classPK}${authParam()}`
		);
	}

	return {
		groupId,
		isDraft,
		pageERC: published.externalReferenceCode,
		publishedFriendlyURL: published.friendlyURL,
		publishedPlid: published.plid,
		publishedURL: published.friendlyURL
			? `${window.location.origin}${sitePath}${published.friendlyURL}`
			: null,
		siteERC: group.externalReferenceCode,
		sitePath,
	};
}

/* ---------- Page definition checks ---------- */

function walkElements(elements, visit, parentName = null) {
	for (const element of elements || []) {
		const definition = element.pageElementDefinition || {};
		const instance = definition.fragmentInstance;
		if (instance) {
			const key = instance.fragmentReference?.defaultFragmentKey || '';
			const fragmentName =
				key
					.replace(/^[A-Z_]+-/, '')
					.split('-')
					.map((p) => p.charAt(0).toUpperCase() + p.slice(1))
					.join(' ') || parentName;
			visit(element, instance, fragmentName);
		}
		walkElements(element.pageElements, visit, parentName);
	}
}

function i18nMaps(value) {
	const maps = [];
	const type = value?.type;
	if (type === 'Text') {
		const inline = value.fragmentLinkTextValue?.textFragmentValue?.fragmentInlineValue;
		if (inline?.value_i18n) {
			maps.push({kind: 'text', map: inline.value_i18n});
		}
	}
	else if (type === 'RichText' || type === 'HTML') {
		const inline = value.htmlFragmentValue?.fragmentInlineValue;
		if (inline?.value_i18n) {
			maps.push({kind: 'text', map: inline.value_i18n});
		}
	}
	else if (type === 'Image') {
		const image = value.fragmentImage?.fragmentImageValue || value.fragmentImage || {};
		if (image.description_i18n) {
			maps.push({kind: 'alt', map: image.description_i18n});
		}
	}
	return maps;
}

function imageHasSource(value) {
	const image = value.fragmentImage?.fragmentImageValue || value.fragmentImage || {};
	if (image.type === 'Mapped' || image.fragmentMappedValue) {
		return false; // content-driven, the alt comes from the mapped item
	}
	const url = image.url_i18n || image.url || image.value_i18n;
	if (!url) {
		return false;
	}
	return Object.values(typeof url === 'object' ? url : {u: url}).some(Boolean);
}

export function checkPageDefinition(spec, languages, defaultLanguage) {
	const findings = [];
	const wanted = languages.map(normalizeLanguage);
	const def = normalizeLanguage(defaultLanguage);

	walkElements(spec?.pageExperiences?.[0]?.pageElements, (element, instance, fragmentName) => {
		const itemId = element.externalReferenceCode;
		for (const editable of instance.fragmentEditableElements || []) {
			const value = editable.fragmentEditableElementValue || {};
			const context = {editableId: editable.id, fragmentName, itemId};

			if (value.type === 'Image' && imageHasSource(value)) {
				const image = value.fragmentImage?.fragmentImageValue || value.fragmentImage || {};
				const alt = image.description_i18n || {};
				const hasAlt = Object.values(alt).some((v) => String(v || '').trim());
				if (!hasAlt) {
					findings.push(
						finding(
							'liferay-model-image-alt',
							context,
							'No alternative text has been set for this image in any language'
						)
					);
				}
			}

			for (const {kind, map} of i18nMaps(value)) {
				const present = Object.keys(map)
					.filter((k) => String(map[k] || '').trim())
					.map(normalizeLanguage);
				if (!present.includes(def)) {
					continue; // nothing authored yet, not a translation problem
				}
				const missing = wanted.filter((l) => !present.includes(l));
				if (!missing.length) {
					continue;
				}
				const shown = missing.slice(0, 4).join(', ') + (missing.length > 4 ? ', …' : '');
				findings.push(
					finding(
						'liferay-model-translations',
						context,
						`${kind === 'alt' ? 'Alternative text' : 'Text'} missing in ${missing.length} of ${wanted.length} site languages: ${shown}`
					)
				);
			}
		}
	});
	return findings;
}

/* ---------- Site checks ---------- */

export function checkPageTitles(pages, defaultLanguage) {
	const findings = [];
	const def = defaultLanguage;
	const byTitle = new Map();
	for (const page of pages) {
		const names = page.name_i18n || {};
		const title = String(names[def] || Object.values(names)[0] || '').trim();
		const context = {
			editableId: page.friendlyUrlPath_i18n?.[def] || page.externalReferenceCode,
			fragmentName: 'Pages',
		};
		if (!title) {
			findings.push(finding('liferay-model-page-title', context, 'The page has no title'));
			continue;
		}
		const key = title.toLowerCase();
		if (!byTitle.has(key)) {
			byTitle.set(key, []);
		}
		byTitle.get(key).push({context, title});
	}
	for (const group of byTitle.values()) {
		if (group.length < 2) {
			continue;
		}
		const paths = group.map((g) => g.context.editableId).join(', ');
		group.forEach((g) =>
			findings.push(
				finding(
					'liferay-model-page-title',
					g.context,
					`"${g.title}" is the title of ${group.length} pages: ${paths}`
				)
			)
		);
	}
	return findings;
}

export function checkDocuments(documents) {
	const findings = [];
	const imageExtension = /\.(png|jpe?g|gif|svg|webp|avif|bmp|tiff?)$/i;
	for (const doc of documents) {
		const isImage =
			String(doc.contentType || '').startsWith('image/') ||
			imageExtension.test(doc.fileName || '') ||
			imageExtension.test(doc.title || '') ||
			/^(png|jpe?g|gif|svg|webp|avif|bmp|tiff?)$/i.test(doc.fileExtension || '');
		if (!isImage) {
			continue;
		}
		if (String(doc.description || '').trim()) {
			continue;
		}
		findings.push(
			finding(
				'liferay-model-document-description',
				{editableId: doc.fileName || doc.title, fragmentName: 'Documents and Media'},
				`"${doc.title}" has no description; pages using it without their own alternative text render an empty alt`,
				{html: doc.contentUrl || ''}
			)
		);
	}
	return findings;
}

/* ---------- Style book token contrast ---------- */

function parseColor(value) {
	if (!value) {
		return null;
	}
	const probe = document.createElement('span');
	probe.style.color = 'rgb(1, 2, 3)';
	probe.style.color = value;
	if (probe.style.color === 'rgb(1, 2, 3)' && !/rgb\(1, 2, 3\)/.test(value)) {
		return null; // not a parseable color
	}
	document.body.appendChild(probe);
	const computed = getComputedStyle(probe).color;
	probe.remove();
	const m = computed.match(/rgba?\(([^)]+)\)/);
	if (!m) {
		return null;
	}
	const parts = m[1].split(/[\s,\/]+/).map(Number);
	if (parts.length < 3 || parts.slice(0, 3).some((n) => Number.isNaN(n))) {
		return null;
	}
	const alpha = parts.length > 3 ? parts[3] : 1;
	if (alpha < 1) {
		return null; // translucent, the effective color depends on what is behind
	}
	return parts.slice(0, 3);
}

function luminance([r, g, b]) {
	const channel = (c) => {
		const s = c / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a, b) {
	const la = luminance(a);
	const lb = luminance(b);
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function toHex([r, g, b]) {
	return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
}

export function checkTokenContrast() {
	const findings = [];
	const root = getComputedStyle(document.documentElement);
	for (const [fg, bg, minimum, kind] of TOKEN_PAIRS) {
		const fgValue = root.getPropertyValue(fg).trim();
		const bgValue = root.getPropertyValue(bg).trim();
		if (!fgValue || !bgValue) {
			continue;
		}
		const a = parseColor(fgValue);
		const b = parseColor(bgValue);
		if (!a || !b) {
			continue;
		}
		const ratio = contrast(a, b);
		if (ratio >= minimum) {
			continue;
		}
		findings.push(
			finding(
				'liferay-model-token-contrast',
				{editableId: `${fg.slice(2)} / ${bg.slice(2)}`, fragmentName: 'Style Book'},
				`${fg.slice(2)} (${toHex(a)}) on ${bg.slice(2)} (${toHex(b)}) is ${ratio.toFixed(2)}:1; ${kind === 'text' ? 'text' : 'controls and borders'} need at least ${minimum}:1`,
				{impact: kind === 'text' ? 'serious' : 'moderate'}
			)
		);
	}
	return findings;
}

/* ---------- Orchestration ---------- */

export async function runModelScan({mode, pageLevelOnly = false}) {
	const info = await resolvePageInfo();
	const notes = [];
	let findings = [];

	let site = null;
	try {
		site = await getJSON(`/o/headless-admin-user/v1.0/sites/${info.groupId}`);
	}
	catch (error) {
		notes.push(`Site languages unavailable: ${error.message}`);
	}
	const languages = site?.availableLanguages || [];
	const defaultLanguage = normalizeLanguage(themeDisplay().getDefaultLanguageId?.() || languages[0] || 'en-US');

	// Page definition (translations, alt texts) through headless-admin-site.
	if (info.siteERC && info.pageERC) {
		try {
			const page = await getJSON(
				`/o/headless-admin-site/v1.0/sites/${encodeURIComponent(info.siteERC)}/site-pages/${encodeURIComponent(info.pageERC)}?nestedFields=pageSpecifications`
			);
			const specs = page.pageSpecifications || [];
			const wantedStatus = mode === 'editor' && info.isDraft ? 'Draft' : 'Approved';
			const spec =
				specs.find((s) => s.status === wantedStatus) ||
				specs.find((s) => s.status === 'Approved') ||
				specs[0];
			findings = findings.concat(checkPageDefinition(spec, languages, defaultLanguage));
		}
		catch (error) {
			notes.push(`Page definition unavailable: ${error.message}`);
		}

		if (!pageLevelOnly) try {
			const pages = await getJSON(
				`/o/headless-admin-site/v1.0/sites/${encodeURIComponent(info.siteERC)}/site-pages?pageSize=200&fields=externalReferenceCode,friendlyUrlPath_i18n,name_i18n`
			);
			findings = findings.concat(checkPageTitles(pages.items || [], defaultLanguage));
			if (pages.totalCount > 200) {
				notes.push(`Page titles checked on the first 200 of ${pages.totalCount} pages`);
			}
		}
		catch (error) {
			notes.push(`Page list unavailable: ${error.message}`);
		}
	}
	else {
		notes.push('The site or the page has no external reference code; page definition checks skipped');
	}

	// Documents and Media images without description.
	if (!pageLevelOnly) try {
		const documents = await getJSON(
			`/o/headless-delivery/v1.0/sites/${info.groupId}/documents?flatten=true&pageSize=200&fields=contentType,contentUrl,description,fileExtension,fileName,id,title`
		);
		findings = findings.concat(checkDocuments(documents.items || []));
		if (documents.totalCount > 200) {
			notes.push(`Library images checked on the first 200 of ${documents.totalCount} documents`);
		}
	}
	catch (error) {
		notes.push(`Documents unavailable: ${error.message}`);
	}

	// Style book tokens, read from the page itself.
	findings = findings.concat(checkTokenContrast());

	return {
		engineVersion: 'model',
		findings,
		notes,
		pageInfo: info,
		timestamp: new Date().toISOString(),
		url: window.location.href,
	};
}
