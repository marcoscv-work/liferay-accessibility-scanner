/**
 * The panel mirrors the page editor's own sidebar panels (header, tabs,
 * body) and relies on Clay utilities served by the portal. This is only the
 * drawer positioning, the few things utilities cannot express and the
 * highlight outline. Selectors are prefixed with .cadmin to beat Clay's own
 * two-class rules.
 */
export const PANEL_CSS = `
html:not(#__):not(#___) .cadmin.lfr-accessibility-scanner {
	--lfr-accessibility-top: 0px;
	--lfr-accessibility-width: 320px;
}
html:not(#__):not(#___) .cadmin .lfr-accessibility-scanner__fab {
	bottom: 1.5rem;
	box-shadow: 0 0.5rem 1rem rgba(0, 0, 0, 0.2);
	overflow: visible;
	position: fixed;
	right: 1.5rem;
	z-index: 989;
}
html:not(#__):not(#___) .cadmin .lfr-accessibility-scanner__fab[aria-expanded="true"],
html:not(#__):not(#___) .cadmin.lfr-accessibility-scanner--docked .lfr-accessibility-scanner__fab {
	display: none;
}
html:not(#__):not(#___) .cadmin .lfr-accessibility-scanner__toolbar-button {
	overflow: visible;
	position: relative;
}
html:not(#__):not(#___) .cadmin .lfr-accessibility-scanner__toolbar-button .badge {
	font-size: 0.625rem;
	line-height: 1;
	min-width: 1.125rem;
	padding: 0.1875rem 0.3125rem;
	position: absolute;
	right: -0.5rem;
	top: -0.5rem;
}
html:not(#__):not(#___) .cadmin .lfr-accessibility-scanner__toolbar-item {
	display: flex;
}
html:not(#__):not(#___) .cadmin .lfr-accessibility-scanner__fab .lexicon-icon {
	height: 1.5rem;
	width: 1.5rem;
}
html:not(#__):not(#___) .cadmin .lfr-accessibility-scanner__fab-check {
	background-color: var(--cadmin-white, #fff);
	border-radius: 50%;
	bottom: -0.25rem;
	color: var(--cadmin-success, #287d3c);
	display: inline-flex;
	line-height: 0;
	padding: 0.0625rem;
	position: absolute;
	right: -0.25rem;
}
html:not(#__):not(#___) .cadmin .lfr-accessibility-scanner__fab-check .lexicon-icon {
	height: 1rem;
	width: 1rem;
}
html:not(#__):not(#___) .cadmin .lfr-accessibility-scanner__fab .badge {
	line-height: 1;
	min-width: 1.5rem;
	padding: 0.3125rem 0.4375rem;
	position: absolute;
	right: -0.5rem;
	top: -0.5rem;
	white-space: nowrap;
}
html:not(#__):not(#___) .cadmin .lfr-accessibility-scanner__panel {
	background-color: var(--cadmin-white, #fff);
	border-left: 1px solid var(--cadmin-gray-300, #e7e7ed);
	bottom: 0;
	color: var(--cadmin-body-color, #272833);
	display: flex;
	flex-direction: column;
	max-width: 100vw;
	position: fixed;
	right: 0;
	top: var(--lfr-accessibility-top);
	width: var(--lfr-accessibility-width);
	z-index: 990;
}
html:not(#__):not(#___) .cadmin .lfr-accessibility-scanner__panel[hidden] {
	display: none;
}
html:not(#__):not(#___) .cadmin .lfr-accessibility-scanner__header {
	flex-shrink: 0;
}

/* Tabs: same subtle baseline as the editor's own sidebar tabs, and the active
   tab overlaps that baseline so no line runs under it. */
html:not(#__):not(#___) .cadmin .lfr-accessibility-scanner__panel .nav-tabs {
	border-bottom-color: var(--cadmin-gray-300, #e7e7ed);
}
html:not(#__):not(#___) .cadmin .lfr-accessibility-scanner__panel .nav-tabs .nav-item {
	margin-bottom: -1px;
}
/* Three tabs must fit the 320px drawer. */
html:not(#__):not(#___) .cadmin .lfr-accessibility-scanner__panel .nav-tabs .nav-link {
	padding-left: 0.75rem;
	padding-right: 0.75rem;
	white-space: nowrap;
}
html:not(#__):not(#___) .cadmin .lfr-accessibility-scanner__panel .nav-tabs .nav-link.active {
	border-bottom-color: var(--cadmin-white, #fff);
	position: relative;
}
html:not(#__):not(#___) .cadmin .lfr-accessibility-scanner__summary {
	border-bottom: 1px solid var(--cadmin-gray-300, #e7e7ed);
}
html:not(#__):not(#___) .cadmin .lfr-accessibility-scanner__results {
	min-height: 0;
	overflow-y: auto;
}
html:not(#__):not(#___) .cadmin .lfr-accessibility-scanner__rule {
	border-bottom: 1px solid var(--cadmin-gray-300, #e7e7ed);
}
html:not(#__):not(#___) .cadmin .lfr-accessibility-scanner__impact {
	flex-shrink: 0;
	font-size: 0.6875rem;
	font-weight: 700;
	height: 1.5rem;
	line-height: 1.5rem;
	margin: 0.125rem 0.5rem 0 0;
	width: 1.5rem;
}
html:not(#__):not(#___) .cadmin .lfr-accessibility-scanner__rule-header {
	border-radius: 0;
	gap: 0.5rem;
	line-height: 1.4;
}
html:not(#__):not(#___) .cadmin .lfr-accessibility-scanner__rule-header .label,
html:not(#__):not(#___) .cadmin .lfr-accessibility-scanner__rule-header .badge {
	margin: 0.125rem 0 0 !important;
}
html:not(#__):not(#___) .cadmin .lfr-accessibility-scanner__rule-header:hover,
html:not(#__):not(#___) .cadmin .lfr-accessibility-scanner__rule-header:focus-visible {
	background-color: var(--cadmin-gray-100, #f7f8f9);
}
html:not(#__):not(#___) .cadmin .lfr-accessibility-scanner__element {
	background-color: var(--cadmin-gray-100, #f7f8f9);
	border-radius: 0.25rem;
	color: var(--cadmin-gray-700, #495057);
	display: block;
	font-size: 0.75rem;
	line-height: 1.5;
	overflow: hidden;
	padding: 0.125rem 0.5rem;
	text-overflow: ellipsis;
	white-space: nowrap;
}
html:not(#__):not(#___) .cadmin .lfr-accessibility-scanner__footer {
	border-top: 1px solid var(--cadmin-gray-300, #e7e7ed);
	flex-shrink: 0;
}
.lfr-accessibility-scanner__highlight {
	outline: 3px solid var(--cadmin-danger, #da1414) !important;
	outline-offset: 3px !important;
	transition: outline-color 0.2s ease;
}
.lfr-accessibility-scanner__highlight--fragment {
	outline: 3px dashed var(--cadmin-warning, #b95000) !important;
	outline-offset: 6px !important;
}
`;
