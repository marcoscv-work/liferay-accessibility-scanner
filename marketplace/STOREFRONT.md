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

Accessibility Scanner brings WCAG scanning into Liferay authoring. It runs axe-core with nine rules that understand how Liferay pages are built, so every finding points at the fragment, editable or widget to fix instead of a CSS selector. In the page editor, Draft audits the page you are editing and Published loads the public page as an anonymous visitor and maps results back to your fragments. From the Page Tree, one button scans every page, in light and dark, stores scores, deltas and findings in site-scoped Objects, and shows each page's score next to its name. It also checks content where it is written: the CMS content editor, Web Content and Blogs. The HTML of every rich text field is audited for missing alternative text, heading structure, vague or repeated link texts and more, and in the CMS a site can block publishing while critical issues remain. Content checks go beyond the DOM through Liferay APIs: missing translations, images without alternative text in fragments and Documents and Media, style book token contrast and page titles. Each scanned page records its theme and style book, so design issues reach the design owner. The Accessibility Report fragment shows score, issues by impact, trend, pages, rules, fragments, themes and style books for the whole team. Administrators decide per site what is available with the Accessibility Settings object, and who can run site scans through regular permissions. Everything runs in the author's browser with the author's session: no external service, no telemetry, no browser plugin, no microservice. Requirements: Liferay DXP 2026.Q2 or 2026.Q3 and a current browser. Automated checks find a share of WCAG failures; findings marked needs review show where a person has to look. Documentation: https://marcoscv-work.github.io/liferay-accessibility-scanner/

(1829 characters)

## Build

| Field | Value |
|---|---|
| App type | Client Extension, "Via Liferay Plugin Packages" |
| Package | `dist/accessibility-scanner.zip` from `npm run build`: one client extension project with the globalJS entry, the Objects batch and the report fragment collection under `static/` |
| Zip file name | Must equal the CET name so `/o/<cet-name>/` resolves (load-bearing up to 2026.Q2) |
| Fragment | Ships inside the package, served at `/o/accessibility-scanner/accessibility-scanner-fragments.zip` for import from the Fragments admin (install guide, section Report) |
| Compatible versions | Only the rows marked green in the compatibility matrix below |

## Storefront images (1920×1080 PNG, ten, the wizard maximum; upload one at a time, in this order)

| # | File | Caption (image description) |
|---|---|---|
| 1 | `storefront/01-editor-draft.png` | Accessibility findings inside the page editor, mapped to the fragment and editable to fix |
| 2 | `storefront/02-published.png` | Published tab: the public page audited as an anonymous visitor, results mapped back to your draft |
| 3 | `storefront/03-page-tree.png` | Site scans from the Page Tree: every page scanned in light and dark, with its score next to its name |
| 4 | `storefront/04-cms-editor.png` | CMS content editor: every rich text field checked before it reaches a page |
| 5 | `storefront/05-web-content.png` | Web Content editor: rich text fields of any structure, description included |
| 6 | `storefront/06-blogs.png` | Blogs editor: the entry body checked as the author writes it |
| 7 | `storefront/07-publish-gate.png` | Optional publish gate in the CMS: critical issues hold the Publish button |
| 8 | `storefront/08-settings.png` | Per-site Accessibility Settings decide what is on, with no code |
| 9 | `storefront/09-report.png` | Accessibility Report fragment: score, issues by impact, trend, pages, rules, fragments, themes and style books |
| 10 | `storefront/10-report-mobile.png` | The report is responsive and switches between light and dark results |

Regenerate with `scripts/storefront-shots.mjs` (raw captures from the local bundle; `SHOT_SITE`/`SHOT_PAGE` pick the site and page, default the Liferay USWDS landing page so the editor shows a real-looking site; content editor shots use the CMS space, the Basic Web Content structure and a blog entry of the local bundle, see the variables at the top of section 5) followed by `scripts/compose-shots.mjs` (framing, margins, zoomed drawer, icon). Video: none for the first version.

## Version

| Field | Value |
|---|---|
| Version | 1.0.0 |
| Release notes | First release. Draft and Published scans in the page editor and site scans from the Page Tree with axe-core 4.14 and nine Liferay-aware rules; rich text checks in the CMS content editor, Web Content and Blogs, with an optional publish gate for critical issues in the CMS; content checks through Liferay APIs; per-site Accessibility Settings; site-scoped Objects with score, trend and theme and style book per page; Accessibility Report fragment with a light and dark switch. |

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
| Documentation URL | https://marcoscv-work.github.io/liferay-accessibility-scanner/ |
| Install and uninstall guide URL | https://marcoscv-work.github.io/liferay-accessibility-scanner/install.html |

## Compatibility matrix

Declare only green rows. Each row is a full run of `scripts/compat-test.sh` on the official `liferay/dxp` Docker image: sign in, loader, objects, editor panel, Draft, Published and Site scans, SPA teardown, report fragment import, and the CMS, Web Content and Blogs editors. Raw results: `marketplace/compat-<tag>.txt`.

| Version | Image | Date | Result | Notes |
|---|---|---|---|---|
| 2026.Q3 | `liferay/dxp:2026.q3.6` | 2026-10-12 | **green, 14 of 14** | Page editor, Page Tree, site scan, objects, fragment, CMS, Web Content and Blogs |
| 2026.Q2 | `liferay/dxp:2026.q2.12` | 2026-10-12 | **green, 13 of 13** | No CMS in this release, so the CMS check does not apply |
| 2026.Q1 LTS | `liferay/dxp:2026.q1.9-lts` | 2026-10-12 | not tested | The image's trial license expired in March 2026; needs a development key |
| 2025.Q4 | `liferay/dxp:2025.q4.12` | 2026-10-12 | not tested | Same expired trial license |
| Master | local source build | 2026-10-12 | green | Development reference |

Declare **2026.Q2 and 2026.Q3** in the wizard. Add 2026.Q1 LTS and 2025.Q4 in a later version once tested with a valid key.

Fixes the matrix found: quarterly releases require the `x-csrf-token` header on every session call to `/o/`, GET included (master does not); the headless admin site pages API is still a beta flag there, so pages are listed through JSON-WS; two published scans started together removed each other's frame.

## Open items before submitting

1. Fill in publisher website and support email.
2. Compatibility of the merged package: rerun on 2026.Q2 and 2026.Q3 (see the matrix).
