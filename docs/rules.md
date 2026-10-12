# Rules

Findings come from three sources. `axe-core` rules are documented by Deque; the Liferay rules and the content checks are documented here.

## Liferay rules (DOM)

These run inside axe on the rendered page and know how Liferay pages are built.

### liferay-placeholder-text
An editable still shows the default text of its fragment ("Heading Example", "Go Somewhere", the card samples). Replace it or remove the fragment.

### liferay-link-destination
A Link or Button fragment has no destination configured (`href` empty, `#` or `javascript:`). Set the link in the fragment configuration.

### liferay-single-h1
The page renders more than one `h1`. Keep one top-level heading and lower the others.

### liferay-generic-link-text
The link or button text ("Read more", "Click here", "Más info") does not describe its destination out of context. Name the destination in the text or add an `aria-label`.

### liferay-duplicate-link-text
Several links share the same text but lead to different places, typical in collection displays. Differentiate the texts or add `aria-label`s that include the item title.

### liferay-new-tab-warning
A link opens a new tab without saying so. Add "(opens in a new tab)" to the text or an `aria-label`.

### liferay-alt-filename
The alternative text of an image is a file name or an automatic label. Describe what the image shows, or mark it decorative with an empty alt.

### liferay-video-captions
A video does not declare captions. Provide captions and a transcript; reported as needing review.

### liferay-carousel-autoplay
A slider advances automatically without a pause or stop control (the OOTB Banner Slider included). Disable autoplay or provide a pause control.

## Content checks (model)

These read the page definition, the site and the style book through Liferay's APIs.

### liferay-model-translations
An editable text or alternative text is not translated into every language of the site. Translate it or disable unused site languages.

### liferay-model-image-alt
An Image editable has a source but no alternative text in any language. Set it in the image editable's configuration.

### liferay-model-document-description
A Documents and Media image has no description. Pages that use it without their own alternative text render an empty alt. Fill the description in Documents and Media.

### liferay-model-token-contrast
A style book token pair fails the minimum contrast (4.5:1 for text, 3:1 for controls and borders). Fix the token in the style book and every page inherits the fix.

### liferay-model-page-title
Two pages share the same title, or a page has none. Give each page a unique title.
