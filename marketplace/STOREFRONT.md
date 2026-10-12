# Marketplace storefront: working doc

Everything the Liferay Marketplace publishing wizard asks for, ready to copy and paste. The wizard freezes the listing on submit and keeps no draft, so review this file first. Constraints checked against the wizard (October 2026).

## Profile

| Field | Value |
|---|---|
| App name (≤50) | `Accessibility Scanner for Liferay` (34 characters) |
| Category | Other (client extension with Objects and a fragment; "Fragments" and "Object Definition" would hide the editor panel, which is the core) |
| Areas | Content Management & Operations, Experience Management |
| Tags (closed vocabulary) | Client Extension Type, Objects, Low Code |
| Icon | `marketplace/icon-1024.png` (1024×1024 PNG, orange rounded square, accessibility figure, check badge) |

### Description (≤2000 characters, plain text, the storefront drops line breaks)

Accessibility Scanner brings WCAG scanning into the Liferay page editor. It runs axe-core together with nine rules that understand how Liferay pages are built, so every finding points at the fragment, editable or widget to fix instead of a CSS selector, and can be highlighted or selected in the editor. Three scopes in one drawer: Draft audits the page you are editing; Published loads the public URL as an anonymous visitor and maps the results back to your draft fragments; Site scans every public and private page of the site, in light and dark when the theme defines a dark scheme, and stores scans, pages and findings in site-scoped Objects with a score per page, a delta against the previous scan and a stale-scan notice. Content checks go beyond the DOM through Liferay's APIs: missing translations, image fragments without alt text, Documents and Media images without description, style book token contrast and page titles. Each scanned page records the theme and style book it was served with, so design issues are attributed to the design. The included Accessibility Report fragment renders score, issues by impact, trend, pages, rules, fragments, themes and style books from the Objects, with a light or dark switch, for anyone on the team. Everything runs in the author's browser with the author's session: no external service, no telemetry, no browser plugin, no microservice. Multisite ready: Objects are scoped per site. Requirements: Liferay DXP quarterly release with client extensions, Objects and the page editor (tested versions listed below), a current Chrome, Edge, Firefox or Safari. Automated checks find a share of WCAG failures; findings marked "needs review" tell you where a person has to look. Documentation and rule reference: https://github.com/marcoscv-work/liferay-accessibility-scanner

(1,713 characters)

## Build

| Field | Value |
|---|---|
| App type | Client Extension, "Via Liferay Plugin Packages" |
| Package | `dist/accessibility-scanner.zip` (globalJS + Objects batch, shared baseURL) once the two zips are merged for publishing; today `dist/accessibility-scanner-editor.zip` and `dist/accessibility-scanner-objects.zip` |
| Zip file name | Must equal the CET name so `/o/<cet-name>/` resolves (load-bearing up to 2026.Q2) |
| Fragment | `dist/accessibility-scanner-fragments.zip`, imported from the Fragments admin (documented in the install guide) |
| Compatible versions | Only the rows marked green in the compatibility matrix below |

## Storefront images (1920×1080 PNG, one upload at a time, in this order)

| # | File | Caption (image description) |
|---|---|---|
| 1 | `storefront/01-editor-draft.png` | Accessibility findings inside the page editor, mapped to the fragment and editable to fix |
| 2 | `storefront/02-editor-full.png` | A docked toolbar button opens a drawer the size of the configuration panel, with Draft, Published and Site tabs |
| 3 | `storefront/03-published.png` | Published tab: the public page audited as an anonymous visitor, results mapped back to your draft |
| 4 | `storefront/04-site-scan.png` | Site tab: every page scanned in light and dark, scores and deltas stored in site-scoped Objects |
| 5 | `storefront/05-report.png` | Accessibility Report fragment: score, issues by impact, trend, pages, rules, fragments, themes and style books |
| 6 | `storefront/06-report-mobile.png` | The report is responsive and switches between light and dark results |

Regenerate with `scripts/storefront-shots.mjs` (raw captures from the local bundle; `SHOT_SITE`/`SHOT_PAGE` pick the site and page, default the Liferay USWDS landing page so the editor shows a real-looking site) followed by `scripts/compose-shots.mjs` (framing, margins, zoomed drawer, icon). Video: none for the first version.

## Version

| Field | Value |
|---|---|
| Version | 1.0.0 |
| Release notes | First release. Draft, Published and Site scans from the page editor with axe-core 4.14 and nine Liferay-aware rules; content checks through Liferay APIs; site-scoped Objects with score, trend and theme and style book per page; Accessibility Report fragment with a light and dark switch. |

## Pricing and licensing

Free, perpetual, no trial (wizard defaults).

## Support

| Field | Value |
|---|---|
| Support URL | https://github.com/marcoscv-work/liferay-accessibility-scanner/issues |
| Publisher website | TO CONFIRM |
| Support email (public) | TO CONFIRM |
| Phone | optional, leave empty |
| EULA URL | optional, Marketplace default applies |
| Documentation URL | https://github.com/marcoscv-work/liferay-accessibility-scanner#readme |
| Install and uninstall guide URL | TO WRITE: deploy the zip, import the fragment collection, propagate, place the report; uninstall removes the client extension and leaves the Objects and their data unless deleted from Objects admin |

## Compatibility matrix

Declare only green rows. Test with the official Docker images (API smoke through a session cookie, then the editor panel and a site scan in a real browser session).

| Version | Image | Date | Tester | Result |
|---|---|---|---|---|
| Master (local bundle, October 2026) | source build | 2026-10-12 | Marcos | green: editor, published, site scan, report |
| 2026.Q3 | `liferay/dxp:2026.q3.x` | | | pending |
| 2026.Q2 | `liferay/dxp:2026.q2.x` | | | pending |

## Open items before submitting

1. Merge the two client extension zips into one package named after the shared baseURL, or declare both packages.
2. Fill in publisher website and support email.
3. Write the install and uninstall guide page.
4. Run the compatibility matrix on at least one quarterly image and mark the result.
5. Review the six storefront images and the icon in this folder.
