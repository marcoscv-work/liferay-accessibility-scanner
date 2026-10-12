# Liferay Accessibility Scanner

WCAG analyzer that runs inside Liferay DXP. It combines [axe-core](https://github.com/dequelabs/axe-core) with rules that understand how Liferay pages are built (fragments, editables, widgets, style books, content), so every finding points at the thing an author has to change, not at a CSS selector.

Product site: https://marcoscv-work.github.io/liferay-accessibility-scanner/

Everything ships as client extensions and is meant to be published on the Liferay Marketplace.

## Install

Deploy `accessibility-scanner.zip` like any client extension. The [install guide](https://marcoscv-work.github.io/liferay-accessibility-scanner/install.html) covers the report fragment, per-site settings, upgrades and uninstalling.

## Client Extensions

| Folder | Type | What it does |
| --- | --- | --- |
| `client-extensions/accessibility-scanner` | `globalJS` + `batch` | Toggle docked in the editor toolbar next to the viewport buttons (floating button only on rendered pages). Right-hand drawer with two tabs, **Draft** and **Published**; site scans open from the **Page Tree** (below). Draft and Published include the page-level content checks (translations, image alt, style book token contrast) with the DOM findings. The site view (opened from the Accessibility button in the Page Tree header, next to Add Page) scans the whole site from the browser: every page's HTML is fetched without credentials (what an anonymous visitor gets) and rendered in a hidden same-origin iframe through `srcdoc` with a `<base href>`, so stylesheets, fragment scripts and the scanner loader load as on the live page; axe, the Liferay rules and the content checks run there and the results are stored in the Objects with the user's session. No server involved; the browser tab must stay visible while it runs (browsers throttle background tabs, which stalls axe). Public and private pages, images of the site and of the Global site, and a light, dark or both color scheme pass (light and dark by default). The scheme is always the author's choice: a site can mix themes and style books, so the scanner does not try to guess whether pages have a dark scheme. The editor tabs show a one-line notice when the site was never scanned or the last scan is older than 14 days. Content runs the model checks below through Liferay's APIs (page definition, site pages, Documents and Media, style book tokens read from `:root`). A tiny loader runs on every page and only fetches the scanner bundle when the editor is open (or when `?accessibilityScan=1` is appended to a rendered page). Two tabs: **Draft in editor** scans the editor DOM; **Published page** loads the public URL in a hidden same-origin frame, runs the scanner there and maps the findings back to the draft fragments through the layout item id. Findings are mapped to fragment, editable and widget, and can be highlighted or selected in the editor. UI built with Clay classes served by the portal. The same package ships the Objects: liferay Objects that store scans, scanned pages and findings (`AccessibilityScan`, `AccessibilityPage`, `AccessibilityFinding`), **site scoped** (entries live under `/o/c/<object>/scopes/{groupId}`, permissions follow site roles). Labels in English and Spanish. On a self-hosted bundle the batch engine imports the definitions even though the log reports the `batch` type as unknown. |
| `client-extensions/accessibility-scanner-service` | `microservice` + `oAuthApplicationHeadlessServer` + `objectAction` | Node service with Playwright: renders every page of a site as an anonymous visitor, runs axe-core plus the same Liferay rules the editor uses (bundled from `accessibility-scanner/src/rules`), scores each page and stores scan, pages and findings in the Objects. `POST /scan` (also the target of the "Run Scan" action on `AccessibilityScan`), `GET /scans/:id`, `GET /health`. LXC only as a client extension; locally run it with Node (see below). This is the piece most likely to be dropped for the Marketplace, so the editor and the Objects do not depend on it. |
| `fragments/accessibility-scanner` | fragment collection | **Accessibility Report** fragment: reads the site's scans from the Objects with the visitor's session and renders score, issues by impact, trend, pages ranking and findings by rule and fragment; configurable (trend length, pages, sections). The three chart cards share one layout: title, a fixed-height chart band (donut gauge, donut by impact and a gridded bar trend scaled 0..100, all the same diameter and stroke) and a centered meta band below (counts, delta, legend, range). A light, dark or all switch shows up when the latest scan covered both schemes. Each scanned page records the theme it was served with (from the theme CSS link) and the style book applied (the page's explicit one, else the site default for that theme), shown per page in the Page Tree site view and aggregated in a **Themes and style books** card (pages, violations, average score). Charts are inline SVG with Clay colors; the impact chart switches to `PieChart` from `@liferay/frontend-js-charts-web` when the portal exposes it in its import map (it does not yet). Re-importing the collection does not update pages that already use the fragment: open the fragment's Usages in the Fragments admin, select the usages and Propagate. `npm run build:fragments` packs it; `scripts/import-fragments.sh <zip> <site>` imports it through the Fragments portlet command with a session login. |

## Rules

Stock axe-core rules tagged `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa` and `best-practice`, plus the Liferay ruleset in `client-extensions/accessibility-scanner/src/rules/index.js`:

| Rule | WCAG | What it catches |
| --- | --- | --- |
| `liferay-placeholder-text` | 1.3.1 | Fragment default texts ("Heading Example", "Go Somewhere", card samples) left in the page. |
| `liferay-link-destination` | 2.4.4 | Link and link-button fragments with no destination configured. |
| `liferay-single-h1` | 1.3.1 | More than one `h1` rendered on the page. |
| `liferay-generic-link-text` | 2.4.4 | "Read more", "Click here", "Más info" and friends. |
| `liferay-duplicate-link-text` | 2.4.4 | Same link text, different destinations (typical in collection displays). |
| `liferay-new-tab-warning` | 3.2.2 | Links opening a new tab without saying so. |
| `liferay-alt-filename` | 1.1.1 | Alt text that is a file name or an automatic label. |
| `liferay-video-captions` | 1.2.2 / 1.2.3 | Videos without declared captions (reported as "needs review"). |
| `liferay-carousel-autoplay` | 2.2.2 | Sliders that advance automatically without a pause control, including the OOTB Banner Slider. |

## Content checks (model)

`client-extensions/accessibility-scanner/src/model.js`, documented in `docs/rules.md`:

| Check | WCAG | Source |
| --- | --- | --- |
| `liferay-model-translations` | 3.1.2 | Page definition (`headless-admin-site`): editable texts and alt texts missing in site languages. |
| `liferay-model-image-alt` | 1.1.1 | Page definition: Image editables with a source and no alt in any language. |
| `liferay-model-document-description` | 1.1.1 | `headless-delivery` documents: library images without description. |
| `liferay-model-token-contrast` | 1.4.3 / 1.4.11 | Style book tokens on `:root` (`light-dark()` resolved through a probe element): text pairs below 4.5:1, control and border pairs below 3:1. |
| `liferay-model-page-title` | 2.4.2 | Site pages: duplicated or empty titles. |

Page and site are resolved through JSON-WS (`group/get-group`, `layout/get-layout`): the draft layout's `classPK` is the published layout, whose `externalReferenceCode` is the page code the admin API needs. Page element codes equal layout structure item ids, so content findings map to fragments in the editor.

## Development

```bash
npm install
npm run build          # dist/accessibility-scanner.zip (scanner, Objects and report fragment)
npm run deploy         # build and copy the zips to $LIFERAY_BUNDLES/osgi/client-extensions (default ~/projects/bundles)
npm run watch          # rebuild and redeploy on change
```

`scripts/build.mjs` produces the same zip layout the Liferay workspace generates (`<name>.client-extension-config.json`, `Dockerfile`, `LCP.json`, `static/`), so the output deploys unchanged to a self-hosted bundle or to LXC. The globalJS entry, the Objects batch and the fragment collection share one project, so Marketplace gets a single package. Batch entries get no CET configuration, matching the workspace plugin: the `WEB-INF` batch header alone imports them, and a CET entry of type batch only logs "Unknown type batch". Each `client-extension.yaml` is the standard workspace format, so the folders can be dropped into a workspace at any time.

Run a site scan locally (Objects must exist):

```bash
cd client-extensions/accessibility-scanner-service && npm install && npx playwright install chromium && npm run build
LIFERAY_URL=http://localhost:8080 LIFERAY_AUTH=user@example.com:password node src/cli.js --group=<groupId> [--viewport=mobile] [--language=es_ES]
```

`SCAN_BASE_URL` overrides the URL the browser visits when it differs from the API URL. `npm start` serves the HTTP API on port 58082. In LXC the service authenticates with the OAuth2 client credentials of `accessibility-scanner-service-oahs`; set `LIFERAY_OAUTH_CLIENT_ID` and `LIFERAY_OAUTH_CLIENT_SECRET` from the injected metadata.

On a self-hosted bundle, create the Objects with:

```bash
LIFERAY_URL=http://localhost:8080 LIFERAY_AUTH=user@example.com:password scripts/create-objects.sh
```

## Draft vs. published

The editor DOM is not what visitors get: the editor adds classes, `tabindex` and `aria-hidden` to editables, renders toppers and overlays over the content (which confuses contrast checks), runs fragment JS in edit mode (the Banner Slider does not autoplay there), uses a narrower viewport and shows the draft, not the published page. The editor tab is for structural feedback while authoring; the published tab is the audit of what is actually served. The public URL is resolved through JSON-WS: the draft layout's `classPK` is the published layout, whose `friendlyURL` is appended to the site path.

## Things learned the hard way

- A client extension zip needs `WEB-INF/liferay-plugin-package.properties` (`Bundle-SymbolicName`, `module-group-id`, `Liferay-Client-Extension-Frontend` or `-Batch`) or the WAB generator rejects it with "The moduleId ... is not correct". The build script writes it.
- On a self-hosted bundle the `batch` and `oAuthApplicationHeadlessServer` types log "Unknown type" errors, but the batch engine bundle tracker still imports `batch/*.batch-engine-data.json`. The Objects get created and published anyway.
- Object field names such as `groupId` are reserved. The scan object uses `siteGroupId`.
- The page editor marks every fragment's content with `aria-hidden="true"`. axe skips anything hidden from assistive technology, so the runner lifts that attribute while the scan runs and restores it afterwards. Without this almost nothing is reported inside the editor.
- `.lfr-tooltip-scope` wraps the whole editor. Never use it to filter editor chrome or every node gets filtered.
- Clay admin resets every element under `.cadmin` with `html:not(#__):not(#___) .cadmin <tag>` selectors. Any custom class loses to that reset, so the panel CSS uses the same prefix, exactly as Clay's own components do.
- A redeploy changes the hashed file names, so open editors keep pointing at files that no longer exist until the page is reloaded.
- Liferay's REST layer (Objects, headless) answers `406 No locales match the accepted languages` when the browser's `Accept-Language` has no matching portal locale (an en-GB browser on an en-US portal). Every fetch sends `Accept-Language` with the portal language from `ThemeDisplay`.
- Editor findings use a Clay outline `sticker` (light background, 1px border) with the initial of the impact and a tooltip (C, S, M, L, R) instead of labels. The panel is torn down on SennaJS navigation out of the editor and remounted when navigating back in.
- Fragment configuration: integer defaults must be strings and checkbox fields take no `dataType`, or the import marks the fragment as a draft with an invalid configuration.
- A page created through `headless-admin-site` with a `FragmentItemExternalReference` to a custom fragment rendered an empty fragment entry link locally; dropping the fragment from the editor works. Worth a closer look before relying on it.
- Testing from a background browser tab stalls axe (timer throttling); use a visible tab.
- Appending an iframe before setting `src` fires a first `load` for `about:blank`; set `src` first or you inject into a document that is about to be replaced.
- Creating the demo page through `headless-admin-site` only worked when the draft specification used element ERCs different from the published ones (`-draft` suffix); identical ERCs in both specifications fail with `UnsupportedOperationException`.

## Demo page

`scripts/demo-page.json` is the payload used to create `/web/guest/accessibility-demo`: default heading, button and card texts, two "Read more" links to different pages, a link opening a new tab, an image whose alt is a file name and a second `h1`. Open it with `?p_l_mode=edit` or `?accessibilityScan=1`.

## Page Tree

Site scans live where all pages are listed. The Accessibility button in the Page Tree header (product menu, between Add Page and Configure Pages) opens the drawer on the site view: latest score and delta, color scheme selector, Scan site now, progress and the ranked pages with their theme and style book. After a scan, every page in the tree shows a score sticker (green 90 and above, yellow 50 and above, red below; the worst color scheme pass when there are several) with the score and issue count in its tooltip. The tree is a React component without extension points, so the button and stickers are re-inserted by a MutationObserver when it re-renders. The button shows only when the site does not disable site scans and the user's role can add Accessibility Scan entries.

## Content editors

The same global JavaScript joins three authoring screens, detected by their DOM:

| Screen | Detected by | What is checked |
|---|---|---|
| CMS content editor (spaces) | `/web/cms/e/...` with `.content-editor__toolbar` and the form fragment | Every rich text field |
| Web Content editor | `form.edit-article-form` (Journal) | Every rich text field of the structure, image fields without description (alt) |
| Blogs editor | `form.edit-entry` of the Blogs portlets | Entry body |

The HTML of each rich text field is read through the editor API (CKEditor 4 in an iframe, CKEditor 5, or AlloyEditor inline), parsed inert (no scripts, handlers or frames), rendered off-screen and audited field by field with axe and the Liferay rules. Styling and page-level rules (contrast, landmarks, page title) are off there, and a content rule flags level 1 headings inside the body. The drawer shows one **Content** tab with a "Go to the field" action.

**CMS publish gate.** The CMS editor fires `contentEditor:validateForm` before publishing. When the site setting *Block publishing CMS content with critical issues* is on, the first Publish click is held, the content is scanned, and publishing continues only when no critical issue is left; otherwise the drawer opens filtered to the critical issues. Web Content and Blogs have no such hook, so they only report.

## Per-site settings

The Objects client extension adds **Accessibility Settings** (site scoped, under Site Administration > Configuration). Every switch turns something off, so a site without an entry keeps the default behavior on every version:

- Hide the panel in the page editor
- Disable the published page scan
- Disable site scans
- Disable checks in the CMS content editor, the web content editor or the blogs editor
- Block publishing CMS content with critical issues (off by default)

CMS spaces hold instance-wide content, so the CMS reads the settings of the **Global** site. Who may run site scans is governed by permissions: the Page Tree button shows only when the user's role can add Accessibility Scan entries.

## Compatibility testing

`scripts/compat-test.sh <tag>` boots an official `liferay/dxp` Docker image, deploys the client extensions and runs `scripts/compat-smoke.mjs` (sign in, loader, objects, editor panel, Draft, Published and Site scans, SPA teardown, fragment import) and `scripts/content-smoke.mjs` (CMS, Web Content and Blogs editors). Results are appended to `marketplace/compatibility.log`. Gotchas learned the hard way: use `127.0.0.1`, not `localhost`, because cookies ignore ports and would mix with any other local portal; fresh images force a password change and open first-visit modals; quarterly releases require the `x-csrf-token` header on every session call, GET included; the headless delivery structures list depends on the search index, so tests read structures through the data engine.

## Brand

`brand/` holds the logo: `logo-mark.svg` (orange gradient rounded square with the accessibility figure inside viewfinder corners, flat rounded shapes in the style of the author's other Marketplace app; the Marketplace icon and the site favicon), `logo-horizontal.svg` and `logo-horizontal-dark.svg` (mark plus the name), and PNG exports. Fonts in the wordmark: Lexend Bold and Source Sans 3 SemiBold.

## Product site

`site/` is the static product website, deployed to GitHub Pages by `.github/workflows/pages.yml` on every push to `master` that touches it (plain HTML, CSS and a few lines of JavaScript; Lexend and Source Sans 3 from Google Fonts). Design direction from the UI/UX Pro Max skill: Hero + Features + CTA pattern, Minimalism and Swiss style, light mode, orange accent. The screenshots under `site/assets/shots` are real product captures taken with `scripts/storefront-shots.mjs` against the local bundle (1920x1080 at 2x, element shots with margins, WebP next to each PNG); they double as Marketplace storefront images. `scripts/propagate-fragment.mjs` propagates a re-imported fragment to the pages using it (what the Fragments admin does from Usages, driven with Playwright). Both scripts need `NODE_PATH` pointing at a `node_modules` with Playwright.

## Roadmap

1. Live checker in the page editor (done).
2. Model-level checks through headless APIs (first five done, see above; pending: web content image fields without alt, "used in N pages" for library images).
3. Authoring-time lint for custom fragments and theme or global CSS client extensions.
   - **Pending (depends on Style Book variants, LPD-104225 / epic LPD-109195):** if style book variants ship, the site scan must read the variants the style book defines (`data-color-scheme` values such as `calm`, `light-high-contrast`, `dark-high-contrast`, plus the `prefers-contrast` media rules) and offer one pass per scheme instead of the fixed light/dark pair. Today the author picks light, dark or both for the whole site.
4. Site scans feeding the Objects (done from the browser, opened from the Page Tree, anonymous through credential-less fetch; the Playwright service stays as an experiment); pending: dashboard custom element reading the Objects, light and dark scheme passes, keyboard traversal, reflow and target size checks.
5. Guided manual review and ACR/VPAT export.
