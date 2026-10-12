/**
 * Resolves the Liferay authoring context of a DOM node: which fragment,
 * editable, layout structure item or widget rendered it. This is what turns a
 * CSS selector from axe into something an author can act on.
 */

const FRAGMENT_SELECTOR =
	'.page-editor__fragment-content, [class*="lfr-layout-structure-item-"]';

function prettifyFragmentKey(className) {
	const key = className
		.replace('lfr-layout-structure-item-', '')
		.replace(/^(basic-component|featured-content|content-display|navigation-menus|forms)-/, '');
	return key
		.split('-')
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(' ');
}

export function resolveContext(element) {
	if (!element || !(element instanceof Element)) {
		return {};
	}

	const editable = element.closest('[data-lfr-editable-id]');
	const fragment = element.closest(FRAGMENT_SELECTOR);
	const topper = element.closest('.page-editor__topper, [data-name]');
	const portlet = element.closest('.portlet-boundary');

	// The wrapper carries lfr-layout-structure-item-<fragmentKey> first and
	// lfr-layout-structure-item-<itemId> last, both in the editor and on
	// rendered pages.
	const itemClasses = fragment
		? [...fragment.classList].filter((c) =>
				c.startsWith('lfr-layout-structure-item-')
			)
		: [];
	const itemClass = itemClasses.length ? itemClasses[itemClasses.length - 1] : null;
	const keyClass = itemClasses.length > 1 ? itemClasses[0] : null;
	const fragmentName =
		topper?.dataset?.name ||
		topper?.querySelector?.('.page-editor__topper__title')?.textContent?.trim() ||
		(keyClass ? prettifyFragmentKey(keyClass) : null);

	return {
		editableId: editable?.dataset.lfrEditableId || null,
		editableType: editable?.dataset.lfrEditableType || null,
		fragmentElement: topper || fragment || null,
		fragmentName,
		itemId: itemClass ? itemClass.replace('lfr-layout-structure-item-', '') : null,
		portletId: portlet?.id || null,
		portletName:
			portlet?.querySelector('.portlet-title-text')?.textContent?.trim() || null,
	};
}

export function contextLabel(context, t) {
	const parts = [];
	if (context.fragmentName) {
		parts.push(context.fragmentName);
	}
	else if (context.portletName) {
		parts.push(`${t('widget')}: ${context.portletName}`);
	}
	else {
		parts.push(t('page'));
	}
	if (context.editableId) {
		parts.push(context.editableId);
	}
	return parts.join(' › ');
}

/**
 * Groups findings by the fragment (or widget) that produced them so the panel
 * can show "one fragment, N issues" instead of N scattered selectors.
 */
export function groupKey(context) {
	return (
		context.itemId ||
		context.portletId ||
		(context.fragmentElement ? 'fragment' : 'page')
	);
}
