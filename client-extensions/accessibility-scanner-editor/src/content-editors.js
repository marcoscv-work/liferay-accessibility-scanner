/**
 * Content authoring screens the scanner can join: the new CMS content editor,
 * the Web Content (Journal) article editor and the Blogs entry editor. Each
 * adapter knows how to find its form, read the HTML of every rich text field
 * whatever editor renders it (CKEditor 4 in an iframe, CKEditor 5, AlloyEditor
 * inline), report structured issues the HTML cannot show (image fields without
 * alternative text) and, for the CMS, hook into publishing.
 */

const JOURNAL_NS = '_com_liferay_journal_web_portlet_JournalPortlet_';

function text(el) {
	return (el?.textContent || '').replace(/\s+/g, ' ').replace(/\*$/, '').trim();
}

/** Label of the form field that wraps `element`, in the DDM, CMS and taglib layouts. */
function fieldLabel(element, fallback) {
	const wrapper = element?.closest?.('.ddm-field, .ddm-field-container, .rich-text-input, .form-group, [data-field-name]');
	const label =
		wrapper?.querySelector?.(':scope > label, :scope > .form-group > label, label.control-label, .ddm-label, legend') ||
		wrapper?.querySelector?.('label');
	return text(label) || wrapper?.dataset?.fieldName || fallback;
}

/**
 * Every rich text editor inside `root`: CKEditor 4 instances (classic iframe,
 * inline AlloyEditor and balloon editors) through the CKEDITOR registry, and
 * CKEditor 5 instances through the element's `ckeditorInstance`.
 */
function richTextFields(root, fallbackLabel) {
	const fields = [];
	const seen = new Set();

	const ck4 = window.CKEDITOR?.instances || {};
	Object.values(ck4).forEach((instance) => {
		const container = instance.container?.$ || document.getElementById(`cke_${instance.name}`) || document.getElementById(instance.name);
		const element = instance.element?.$ || container;
		if (!container || !root.contains(container)) {
			return;
		}
		let html = '';
		try {
			html = instance.getData();
		}
		catch {
			html = '';
		}
		seen.add(container);
		fields.push({
			editor: instance,
			element: container.closest('.ddm-field, .form-group, .rich-text-input') || container,
			html,
			label: fieldLabel(element, fallbackLabel),
		});
	});

	root.querySelectorAll('.ck-editor__editable').forEach((editable) => {
		const instance = editable.ckeditorInstance;
		const container = editable.closest('.ck-editor') || editable;
		if (seen.has(container)) {
			return;
		}
		seen.add(container);
		let html = '';
		try {
			html = instance ? instance.getData() : editable.innerHTML;
		}
		catch {
			html = editable.innerHTML;
		}
		fields.push({
			editor: instance,
			element: container.closest('.ddm-field, .form-group, .rich-text-input') || container,
			html,
			label: fieldLabel(container, fallbackLabel),
		});
	});

	// AlloyEditor (Blogs) is CKEditor 4 inline; if the registry missed it, read the DOM.
	root.querySelectorAll('.alloy-editor[contenteditable="true"]').forEach((editable) => {
		if ([...seen].some((el) => el.contains(editable) || editable.contains(el))) {
			return;
		}
		seen.add(editable);
		fields.push({editor: null, element: editable, html: editable.innerHTML, label: fieldLabel(editable, fallbackLabel)});
	});

	return fields.filter((field) => field.html && field.html.replace(/<[^>]*>|&nbsp;|\s/g, '').length + (field.html.match(/<(img|iframe|video|table)\b/gi) || []).length > 0);
}

/** Web Content image fields: the picker stores alt text as the image description. */
function journalImageFindings(root) {
	const findings = [];
	root.querySelectorAll('.ddm-field, .ddm-field-container').forEach((wrapper) => {
		const preview = wrapper.querySelector('.image-picker-preview img, img.image-picker-preview');
		const description = wrapper.querySelector('input[name$="-description"]');
		if (!preview || !description || description.value.trim()) {
			return;
		}
		findings.push({
			context: {fragmentElement: wrapper, fragmentName: fieldLabel(wrapper, 'Image')},
			description: 'Image fields need an image description, which Liferay renders as the alternative text',
			element: null,
			help: 'Image field without alternative text',
			helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html',
			html: preview.outerHTML.slice(0, 300),
			impact: 'serious',
			message: 'Add an image description in the field, or mark the image as decorative in the template.',
			needsReview: false,
			ruleId: 'liferay-image-field-alt',
			selector: '',
			source: 'model',
			wcag: ['1.1.1'],
		});
	});
	return findings;
}

const ADAPTERS = [
	{
		// The CMS content editor is a display page in the hidden CMS site,
		// /web/cms/e/<structure>/<classNameId>/<entryId>, built around a form fragment.
		detect: () =>
			document.querySelector('form.cms-object-layout-form') ||
			(/\/web\/cms\/e\//.test(window.location.pathname) && document.querySelector('.content-editor__toolbar') && document.querySelector('form.lfr-layout-structure-item-form')),
		fields: (root) => richTextFields(document.body.contains(root) ? root.closest('main, #content, body') || root : root, 'Content'),
		// Spaces hold instance-wide content, so their settings live in the Global site.
		groupId: () => window.Liferay?.ThemeDisplay?.getCompanyGroupId?.() || window.Liferay?.ThemeDisplay?.getScopeGroupId?.(),
		kind: 'cms',
		label: 'CMS content',
		settingKey: 'disableCMSEditor',
		structuredFindings: () => [],
		toolbar: () => document.querySelector('.content-editor__toolbar'),
	},
	{
		detect: () => document.querySelector('form.edit-article-form'),
		fields: (root) => richTextFields(root, 'Content'),
		groupId: () => document.getElementById(`${JOURNAL_NS}groupId`)?.value || window.Liferay?.ThemeDisplay?.getScopeGroupId?.(),
		kind: 'journal',
		label: 'Web content',
		settingKey: 'disableWebContentEditor',
		structuredFindings: journalImageFindings,
		toolbar: () => document.querySelector('nav.tbar-article'),
	},
	{
		detect: () => {
			const form = document.querySelector('form.edit-entry');
			return form && /Blogs/.test(form.id || form.closest('[id*="Blogs"]')?.id || '') ? form : null;
		},
		fields: (root) => richTextFields(root.closest('.portlet-boundary') || root, 'Entry'),
		groupId: () => window.Liferay?.ThemeDisplay?.getScopeGroupId?.(),
		kind: 'blogs',
		label: 'Blog entry',
		settingKey: 'disableBlogsEditor',
		structuredFindings: () => [],
		toolbar: () => null,
	},
];

export function detectContentEditor() {
	for (const adapter of ADAPTERS) {
		const root = adapter.detect();
		if (root) {
			return {...adapter, root};
		}
	}
	return null;
}

export const CONTENT_EDITOR_SELECTOR = 'form.cms-object-layout-form, .content-editor__toolbar, form.edit-article-form, form.edit-entry';
