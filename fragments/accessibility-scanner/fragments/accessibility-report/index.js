/* global fragmentElement */

/**
 * Accessibility Report fragment: reads the scans of the current site from the
 * Accessibility Scan Objects (site scoped) and renders score, issues by impact,
 * trend, pages and findings. Charts are inline SVG with Clay colors; when the
 * portal exposes Liferay's chart components through its import map the pie
 * switches to `PieChart` from `@liferay/frontend-js-charts-web`.
 */
(function () {
	const root = fragmentElement.querySelector('.accessibility-report');
	const body = root.querySelector('.accessibility-report__body');
	const groupId = root.dataset.groupId;
	const trendLength = Math.max(2, Number(root.dataset.trendLength) || 6);
	const pageLimit = Math.max(1, Number(root.dataset.pageLimit) || 8);
	const show = {
		design: root.dataset.showDesign !== 'false',
		fragments: root.dataset.showFragments === 'true',
		pages: root.dataset.showPages === 'true',
		rules: root.dataset.showRules === 'true',
	};
	const editMode = root.dataset.editMode === 'true';
	const lang = (window.Liferay?.ThemeDisplay?.getLanguageId?.() || 'en').startsWith('es') ? 'es' : 'en';

	const T = {
		en: {
			all: 'All',
			byDesign: 'Themes and style books',
			byFragment: 'Findings by fragment',
			byImpact: 'Issues by impact',
			dark: 'Dark',
			light: 'Light',
			scheme: 'Color scheme',
			byRule: 'Findings by rule',
			critical: 'Critical',
			forbidden: 'Sign in with a role that can read accessibility scans to see this report.',
			issues: 'issues',
			lastScan: 'Last scan',
			minor: 'Minor',
			moderate: 'Moderate',
			noIssues: 'No issues',
			noScans: 'This site has not been scanned yet. Open any page in the editor, open the Accessibility panel and run a site scan.',
			ofHundred: 'of 100',
			pages: 'pages',
			pagesRank: 'Pages with most issues',
			pagesScore: '{0} pages · score {1}',
			styleBookLabel: 'Style book: {0}',
			themeLabel: 'Theme: {0}',
			review: 'Needs review',
			scans: 'scans',
			score: 'Site score',
			scoreRange: 'from {0} to {1}',
			serious: 'Serious',
			toReview: 'to review',
			trend: 'Score trend',
			vsPrevious: 'vs previous scan',
		},
		es: {
			all: 'Todos',
			byDesign: 'Temas y style books',
			byFragment: 'Hallazgos por fragmento',
			byImpact: 'Problemas por impacto',
			dark: 'Oscuro',
			light: 'Claro',
			scheme: 'Esquema de color',
			byRule: 'Hallazgos por regla',
			critical: 'Críticos',
			forbidden: 'Inicia sesión con un rol que pueda leer los escaneos de accesibilidad para ver este informe.',
			issues: 'problemas',
			lastScan: 'Último escaneo',
			minor: 'Leves',
			moderate: 'Moderados',
			noIssues: 'Sin problemas',
			noScans: 'Este sitio aún no se ha escaneado. Abre una página en el editor, despliega el panel de Accesibilidad y lanza un escaneo del sitio.',
			ofHundred: 'de 100',
			pages: 'páginas',
			pagesRank: 'Páginas con más problemas',
			pagesScore: '{0} páginas · puntuación {1}',
			styleBookLabel: 'Style book: {0}',
			themeLabel: 'Tema: {0}',
			review: 'Por revisar',
			scans: 'escaneos',
			score: 'Puntuación del sitio',
			scoreRange: 'de {0} a {1}',
			serious: 'Graves',
			toReview: 'por revisar',
			trend: 'Evolución de la puntuación',
			vsPrevious: 'frente al escaneo anterior',
		},
	}[lang];

	const IMPACTS = [
		['critical', 'var(--danger, #da1414)'],
		['serious', 'var(--warning, #b95000)'],
		['moderate', 'var(--info, #2e5aac)'],
		['minor', 'var(--secondary, #6b6c7e)'],
		['review', 'var(--gray-400, #cdced9)'],
	];

	/* Pages of a two-pass scan carry the scheme in `experience` ("anonymous · dark"). */
	function schemeOf(page) {
		const m = /·\s*(light|dark)\b/.exec(page.experience || '');
		return m ? m[1] : null;
	}

	let currentScheme = 'all';
	let cache = null;

	function esc(value) {
		return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	}

	async function api(path) {
		const response = await fetch(path, {
			credentials: 'include',
			headers: {
				Accept: 'application/json',
				// Avoid 406 when the visitor's browser language is not a portal locale.
				'Accept-Language': (window.Liferay?.ThemeDisplay?.getLanguageId?.() || 'en_US').replace('_', '-'),
				// Quarterly releases require the CSRF token on session GETs too.
				...(window.Liferay?.authToken ? {'x-csrf-token': window.Liferay.authToken} : {}),
			},
		});
		if (!response.ok) {
			const error = new Error(`HTTP ${response.status}`);
			error.status = response.status;
			throw error;
		}
		return response.json();
	}

	function hasImportMapEntry(name) {
		const map = document.querySelector('script[type="importmap"]');
		try {
			return Boolean(map && JSON.parse(map.textContent).imports[name]);
		}
		catch {
			return false;
		}
	}

	function card(title, content, extraClass = '') {
		return `
			<div class="card accessibility-report__card ${extraClass}">
				<div class="card-body">
					<h3 class="accessibility-report__card-title">${esc(title)}</h3>
					${content}
				</div>
			</div>`;
	}

	/** Chart card: fixed-height chart band plus a centered meta band. */
	function chartCard(title, {chart, meta}, attrs = '') {
		return card(
			title,
			`<div class="accessibility-report__chart-area"${attrs}>${chart}</div><div class="accessibility-report__chart-meta">${meta}</div>`
		);
	}

	const DONUT_R = 42;
	const DONUT_C = 2 * Math.PI * DONUT_R;

	/**
	 * Donut ring shared by the score gauge and the impact chart so both have
	 * the same diameter, stroke and typography. `segments` is a list of
	 * [share 0..1, color]; a single full segment renders the gauge arc.
	 */
	function donut({caption, label, segments, track = true, value}) {
		let offset = 0;
		const gap = segments.length > 1 ? 1.5 : 0;
		const arcs = segments.map(([share, color, title]) => {
			const length = Math.max(0, share * DONUT_C - gap);
			const arc = `<circle cx="50" cy="50" fill="none" r="${DONUT_R}" stroke="${color}" stroke-dasharray="${length.toFixed(2)} ${DONUT_C.toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" stroke-linecap="${segments.length > 1 ? 'butt' : 'round'}" stroke-width="10">${title ? `<title>${esc(title)}</title>` : ''}</circle>`;
			offset += share * DONUT_C;
			return arc;
		});
		return `
			<svg aria-label="${esc(label)}" class="accessibility-report__donut" role="img" viewBox="0 0 100 100">
				${track ? `<circle cx="50" cy="50" fill="none" r="${DONUT_R}" stroke="var(--gray-200, #f1f2f5)" stroke-width="10"></circle>` : ''}
				<g transform="rotate(-90 50 50)">${arcs.join('')}</g>
				<text class="accessibility-report__donut-value" text-anchor="middle" x="50" y="54">${esc(value)}</text>
				<text class="accessibility-report__donut-caption" text-anchor="middle" x="50" y="66">${esc(caption)}</text>
			</svg>`;
	}

	/** Score gauge, 0..100, colored by threshold. */
	function gauge(score) {
		const value = Math.max(0, Math.min(100, score || 0));
		const color = value >= 90 ? 'var(--success, #287d3c)' : value >= 50 ? 'var(--warning, #b95000)' : 'var(--danger, #da1414)';
		return donut({
			caption: T.ofHundred,
			label: `${T.score}: ${value} ${T.ofHundred}`,
			segments: [[value / 100, color]],
			value,
		});
	}

	/** Issues by impact as a donut, with the legend as the card's meta band. */
	function pie(counts) {
		const total = IMPACTS.reduce((s, [k]) => s + (counts[k] || 0), 0);
		if (!total) {
			return {
				chart: donut({caption: T.issues, label: T.noIssues, segments: [], value: 0}),
				meta: `<div class="accessibility-report__chart-note">${esc(T.noIssues)}</div>`,
			};
		}
		const present = IMPACTS.filter(([k]) => counts[k]);
		return {
			chart: donut({
				caption: T.issues,
				label: `${T.byImpact}: ${present.map(([k]) => `${T[k]} ${counts[k]}`).join(', ')}`,
				segments: present.map(([key, color]) => [counts[key] / total, color, `${T[key]}: ${counts[key]}`]),
				track: false,
				value: total,
			}),
			meta: `<ul class="accessibility-report__legend">${present
				.map(([key, color]) => `<li><span class="accessibility-report__swatch" style="background:${color}"></span><span>${esc(T[key])}</span><span class="accessibility-report__legend-count">${counts[key]}</span></li>`)
				.join('')}</ul>`,
		};
	}

	function shortDate(value) {
		return new Date(value).toLocaleDateString(undefined, {day: 'numeric', month: 'short'});
	}

	/** Score trend as bars from a shared baseline; meta summarizes the range. */
	function trend(scans) {
		const ordered = [...scans].reverse();
		const scores = ordered.map((s) => s.score ?? 0);
		const chart = `
			<div aria-label="${esc(T.trend)}: ${ordered.map((s) => `${shortDate(s.startDate)} ${s.score ?? 0}`).join(', ')}" class="accessibility-report__trend" role="img">
				<div class="accessibility-report__trend-bars">${ordered
					.map(
						(s) => `
					<div class="accessibility-report__trend-item" title="${esc(new Date(s.startDate).toLocaleString())}: ${s.score ?? 0}">
						<div class="accessibility-report__trend-value">${s.score ?? 0}</div>
						<div class="accessibility-report__trend-bar" style="--trend-ratio: ${Math.max(0, Math.min(100, s.score ?? 0)) / 100}"></div>
					</div>`
					)
					.join('')}</div>
				<div class="accessibility-report__trend-labels">${ordered.map((s) => `<div class="accessibility-report__trend-label">${esc(shortDate(s.startDate))}</div>`).join('')}</div>
			</div>`;
		const meta = `
			<div>${ordered.length} ${esc(T.scans)}</div>
			<div class="accessibility-report__chart-note">${esc(T.scoreRange.replace('{0}', Math.min(...scores)).replace('{1}', Math.max(...scores)))}</div>`;
		return {chart, meta};
	}

	function rank(items, max, valueKey, labelKey, formatter) {
		if (!items.length) {
			return `<p class="text-secondary mb-0">${esc(T.noIssues)}</p>`;
		}
		return `<ul class="accessibility-report__rank">${items
			.map((item) => {
				const value = item[valueKey];
				const pct = max ? Math.round((value / max) * 100) : 0;
				return `
				<li>
					<div class="accessibility-report__rank-label">
						<span title="${esc(item[labelKey])}">${esc(item[labelKey])}</span>
						<span class="text-secondary flex-shrink-0 ml-2">${esc(formatter ? formatter(item) : value)}</span>
					</div>
					<div aria-hidden="true" class="progress"><div class="progress-bar" style="width: ${pct}%"></div></div>
				</li>`;
			})
			.join('')}</ul>`;
	}

	async function renderLiferayPie(container, counts) {
		if (!hasImportMapEntry('@liferay/frontend-js-charts-web') || !hasImportMapEntry('react-dom/client')) {
			return;
		}
		try {
			const [{PieChart}, React, {createRoot}] = await Promise.all([
				import('@liferay/frontend-js-charts-web'),
				import('react'),
				import('react-dom/client'),
			]);
			const data = IMPACTS.filter(([k]) => counts[k]).map(([k]) => ({label: T[k], value: counts[k]}));
			container.innerHTML = '<div class="accessibility-report__chart"></div>';
			createRoot(container.firstElementChild).render(React.createElement(PieChart, {data}));
		}
		catch (error) {
			console.warn('[accessibility-report] chart components unavailable', error);
		}
	}

	async function loadData() {
		const result = await api(`/o/c/accessibilityscans/scopes/${groupId}?sort=startDate:desc&pageSize=${trendLength}&nestedFields=accessibilityScanPages`);
		const scans = (result.items || []).filter((s) => s.scanStatus === 'completed' || s.scanStatus === 'cancelled');
		if (!scans.length) {
			return {scans};
		}
		const latest = scans[0];
		const pages = [...(latest.accessibilityScanPages || [])];
		for (const page of pages.slice(0, 40)) {
			try {
				const full = await api(`/o/c/accessibilitypages/scopes/${groupId}/${page.id}?nestedFields=accessibilityPageFindings`).catch(() => api(`/o/c/accessibilitypages/${page.id}?nestedFields=accessibilityPageFindings`));
				page.findings = full.accessibilityPageFindings || [];
			}
			catch {
				page.findings = [];
			}
		}
		const schemes = [...new Set(pages.map(schemeOf).filter(Boolean))];
		return {latest, pages, previous: scans[1], scans, schemes};
	}

	/** Aggregates of the pages that belong to the selected scheme. */
	function aggregate(pages, scheme) {
		const selected = scheme === 'all' ? pages : pages.filter((p) => schemeOf(p) === scheme);
		const impactCounts = {};
		const ruleMap = new Map();
		const fragmentMap = new Map();
		const designMap = new Map();
		let violations = 0;
		let needsReview = 0;
		for (const page of selected) {
			violations += page.violations || 0;
			needsReview += page.needsReview || 0;
			if (page.themeName) {
				const name = [T.themeLabel.replace('{0}', page.themeName), page.styleBookName ? T.styleBookLabel.replace('{0}', page.styleBookName) : ''].filter(Boolean).join(' · ');
				const d = designMap.get(name) || {count: 0, name, pages: 0, scoreSum: 0, violations: 0};
				d.pages += 1;
				d.scoreSum += page.score || 0;
				d.violations += page.violations || 0;
				d.count = d.violations;
				designMap.set(name, d);
			}
			for (const f of page.findings || []) {
				const key = f.needsReview ? 'review' : f.impact;
				impactCounts[key] = (impactCounts[key] || 0) + 1;
				if (f.needsReview) {
					continue;
				}
				const r = ruleMap.get(f.ruleId) || {count: 0, help: f.help, ruleId: f.ruleId};
				r.count += 1;
				ruleMap.set(f.ruleId, r);
				const name = f.fragmentName || '—';
				const g = fragmentMap.get(name) || {count: 0, name};
				g.count += 1;
				fragmentMap.set(name, g);
			}
		}
		return {
			byDesign: [...designMap.values()].sort((a, b) => b.count - a.count).map((d) => ({...d, score: Math.round(d.scoreSum / d.pages)})),
			byFragment: [...fragmentMap.values()].sort((a, b) => b.count - a.count).slice(0, 8),
			byRule: [...ruleMap.values()].sort((a, b) => b.count - a.count).slice(0, 8),
			impactCounts,
			needsReview,
			pages: [...selected].sort((a, b) => (b.violations ?? 0) - (a.violations ?? 0)),
			score: selected.length ? Math.round(selected.reduce((s, p) => s + (p.score || 0), 0) / selected.length) : 0,
			violations,
		};
	}

	function schemeSwitch(schemes) {
		if (schemes.length < 2) {
			return '';
		}
		return `
			<div class="btn-group btn-group-sm mb-3" role="group" aria-label="${esc(T.scheme)}">
				${['all', ...schemes].map((s) => `<button aria-pressed="${currentScheme === s}" class="btn ${currentScheme === s ? 'btn-primary' : 'btn-secondary'}" data-scheme="${s}" type="button">${esc(T[s])}</button>`).join('')}
			</div>`;
	}

	function renderView() {
		const {latest, pages, previous, scans, schemes} = cache;
		const current = aggregate(pages, currentScheme);
		const previousPages = previous?.accessibilityScanPages || [];
		const previousViolations = currentScheme === 'all'
			? previous?.violations
			: previousPages.filter((p) => schemeOf(p) === currentScheme).reduce((s, p) => s + (p.violations || 0), 0);
		const hasPrevious = previous && (currentScheme === 'all' || previousPages.some((p) => schemeOf(p) === currentScheme));
		const delta = hasPrevious ? current.violations - (previousViolations || 0) : null;
		const trendScans = currentScheme === 'all'
			? scans
			: scans.map((s) => {
				const ps = (s.accessibilityScanPages || []).filter((p) => schemeOf(p) === currentScheme);
				return ps.length ? {...s, score: Math.round(ps.reduce((a, p) => a + (p.score || 0), 0) / ps.length)} : null;
			}).filter(Boolean);

		const deltaLabel = delta === null ? '' : `<span class="label ${delta > 0 ? 'label-danger' : delta < 0 ? 'label-success' : 'label-secondary'}">${delta > 0 ? '+' : ''}${delta} ${esc(T.vsPrevious)}</span>`;
		const score = {
			chart: gauge(current.score),
			meta: `
				<div>${current.violations} ${esc(T.issues)} · ${current.pages.length} ${esc(T.pages)} · ${current.needsReview} ${esc(T.toReview)}</div>
				${deltaLabel ? `<div>${deltaLabel}</div>` : ''}
				<div class="accessibility-report__chart-note">${esc(T.lastScan)} · ${esc(new Date(latest.startDate).toLocaleString())}</div>`,
		};

		// Scans stored before themes were recorded have no design data to show.
		const showDesign = show.design && current.byDesign.length > 0;
		const detailCount = [show.pages, show.rules, show.fragments, showDesign].filter(Boolean).length;
		const detailCol = detailCount === 4 ? 'col-lg-6' : 'col-lg-4 col-md-6';

		body.innerHTML = `
			${schemeSwitch(schemes)}
			<div class="row">
				<div class="col-lg-4 col-md-6 mb-4">${chartCard(T.score, score)}</div>
				<div class="col-lg-4 col-md-6 mb-4">${chartCard(T.byImpact, pie(current.impactCounts), ' data-pie')}</div>
				<div class="col-lg-4 col-md-12 mb-4">${chartCard(T.trend, trend(trendScans))}</div>
			</div>
			<div class="row">
				${show.pages ? `<div class="${detailCol} mb-4">${card(T.pagesRank, rank(current.pages.slice(0, pageLimit), current.pages[0]?.violations || 1, 'violations', 'pageTitle', (p) => `${p.violations} · ${p.score}`))}</div>` : ''}
				${show.rules ? `<div class="${detailCol} mb-4">${card(T.byRule, rank(current.byRule, current.byRule[0]?.count || 1, 'count', 'help'))}</div>` : ''}
				${show.fragments ? `<div class="${detailCol} mb-4">${card(T.byFragment, rank(current.byFragment, current.byFragment[0]?.count || 1, 'count', 'name'))}</div>` : ''}
				${showDesign ? `<div class="${detailCol} mb-4">${card(T.byDesign, rank(current.byDesign, current.byDesign[0]?.count || 1, 'count', 'name', (d) => T.pagesScore.replace('{0}', d.pages).replace('{1}', d.score)))}</div>` : ''}
			</div>`;

		renderLiferayPie(body.querySelector('[data-pie]'), current.impactCounts);
	}

	async function render() {
		try {
			cache = await loadData();
		}
		catch (error) {
			body.innerHTML = `<p class="text-secondary">${esc(error.status === 403 || error.status === 401 ? T.forbidden : error.message)}</p>`;
			return;
		}
		if (!cache.scans.length) {
			body.innerHTML = editMode || window.Liferay?.ThemeDisplay?.isSignedIn?.() ? `<p class="text-secondary">${esc(T.noScans)}</p>` : '';
			return;
		}
		renderView();
	}

	body.addEventListener('click', (event) => {
		const button = event.target.closest('[data-scheme]');
		if (button && cache) {
			currentScheme = button.dataset.scheme;
			renderView();
		}
	});

	render();
})();
