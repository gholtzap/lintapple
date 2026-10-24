<img src="https://lintapple.vercel.app/assets/logo.png" width="96" height="96" alt="lintapple logo">

# lintapple

It should be impossible for AI to make a bad UI.

[npm](https://www.npmjs.com/package/lintapple) · [Demo](https://lintapple.vercel.app/)

## Install

Requires Node.js 22 or later. Run in your app’s project directory:

```sh
npm install -D lintapple && npx lintapple init
```

This creates `ui-policy.json` and a `lint:ui` script. Existing settings are kept.
Set the fonts and text sizes in `ui-policy.json` to match your app. Set the app URL in the `lint:ui` script; the default is `http://localhost:3000`.

## Use

Start your app, then run:

```sh
npm run lint:ui
```

Text reports group repeated problems and list their states, screen sizes, and themes.
The JSON report keeps every finding and adds a `summary` with counts by rule and groups with all measurements.
A group means the same rule, element, expected value, interaction phase, document, and frame path. Measured values can differ between occurrences.
Confirmed failures and unresolved checks have separate counts. Unresolved checks require review and still exit with code `1`.
The CLI writes the active font policy to stderr before the check. A font mismatch means the page differs from that policy.
Each finding includes the rule, element, measured value, and suggested fix.
Exit codes: `0` passed, `1` findings, `2` check did not finish.

To check another URL or save a JSON report:

```sh
npx lintapple http://localhost:3000 --json
```

For a page that loads asynchronously, add `--ready '[data-app-ready]'` with a selector that is visible when the page is ready.

## Use in Playwright

Add this to an existing test after the page is ready:

```ts
import { expectUI } from 'lintapple/playwright';

await expectUI(page, testInfo);
```

Checks apply to the current document. Child frames are not checked automatically.
Each page and state report includes `frameCoverage` with the checked document and omitted child frames, including nested frames. Frame paths such as `main/0/1` identify frames by their child order at the time of the check.
To check a frame, call `checkPage(frame)` separately. This includes cross-origin frames that Playwright can access.
A check with no findings does not prove that omitted frames pass.

Findings fail the test and attach a JSON report. If a passing page has omitted frames, the helper attaches a coverage report. The helper reads your `ui-policy.json`.
See the [example tests](examples/playwright/).

## Mark layout elements

Font, contrast, control size, and screen bounds checks work without extra markup.
Add these attributes for checks that need layout information:

| Attribute | Use on |
| --- | --- |
| `data-ui-stack` | A group whose child spacing must be checked. |
| `data-ui-actions` | A button group whose gaps must be checked. |
| `data-ui-container` | A surface whose button insets must be checked. |
| `data-ui-number` | A changing number that needs equal digit widths. |
| `data-ui-content` | A container whose text must stay inside its edges. |
| `data-ui-align="start"` | A group whose marked elements must align. Use `center` or `end` for other alignments. |
| `data-ui-align-item` | Each element to compare in an alignment group. |
| `data-ui-radius` | An outer surface with equal corner radii and insets. |
| `data-ui-radius-inner` | Its direct inner surface. Its radius must equal the outer radius minus the inset. |

You can also use `controlContainers` in the policy to select existing button containers.
See [example styles](examples/ui.css).

## Automatic tooltip checks

CLI and `checkUrl` scans open declared tooltips on hover and keyboard focus. They check the rendered page in each open state and check Escape dismissal and focus retention. While the hover tooltip is open, they resize to the other configured viewports. A tooltip can close on resize; if it stays open, it must fit. Resize findings retain the actual screen size.

Triggers are discovered through `aria-describedby` references to existing `role="tooltip"` elements, or through `data-ui-tooltip` IDs. A `data-ui-tooltip` target can be created when the tooltip opens. Scans use hover, Tab, and Escape; they do not click triggers or submit forms. Explicit tooltip plans take priority for their triggers. Automatic discovery runs after the supplied interaction plan, on the resulting page state.

`accessibilityCoverage.tooltips` lists automatically checked triggers and unmeasured cases. Native `title` tooltips, disabled or unreachable triggers, duplicate IDs, and tooltip elements without a visible declared trigger are reported as unmeasured. Scans check at most 100 declared tooltip relationships per page. These coverage limits alone do not change the exit code. Tooltips that fail to open on hover or focus, or fail to close on Escape, produce findings.

An unmarked trigger whose tooltip does not exist until it opens cannot be discovered. Use an explicit interaction plan for it. `checkPage` and `expectUI` remain passive: open the tooltip in your test before calling them. Child frames still need separate checks.

## Control content insets

Buttons and custom dropdown controls are checked by default. Their visible text and DOM icons (`svg`, `img`, and `canvas`) need at least 8 px from the inner left and right borders. The check uses rendered text ranges and icon boxes, including transformed and absolute content. It does not require contract attributes. It does not apply to general containers.

Native select arrows and labels, native input content, CSS images, generated content, and clipped content cannot be fully measured by this check. `controlContentCoverage.unmeasured` lists these limits. CLI text reports show them, and `expectUI` saves a coverage attachment. An unmeasured item is not a spacing pass; it needs visual review. Coverage limits alone do not change the exit code.

Use a DOM icon to make arrow spacing measurable. A matching `contentInsetRules` entry replaces the automatic check for that control and can set component-specific edges and minimums. Existing `content-inset` exceptions also apply to automatic findings.

## Custom content insets

Use `contentInsetRules` in `ui-policy.json` to check the space between a component's inner edges and selected content. The default list is empty. Controls still receive the automatic check described above.

```json
{
  "contentInsetRules": [
    {
      "selector": ".sidebar-row",
      "contentSelector": ".icon, .label",
      "insets": { "left": 8, "right": 8 }
    }
  ]
}
```

The first rule whose `selector` matches a container applies. `contentSelector` selects descendant element boxes. A nested container that matches the same selector owns its own content. Hidden content and selectors with no visible matches are skipped. Raw text nodes and pseudo-elements are not measured; wrap text in an element if it needs this check.

Choose physical edges from `left`, `top`, `right`, and `bottom`. Values must be finite, nonnegative CSS pixel minimums. Omitted edges are not checked. The rule measures rendered distances from inside the border, with a 0.1 px tolerance. Borders do not count as padding. Transforms and absolute positions affect the measurement.

A `content-inset` finding names the content element, its container, the failing edge, the measured distance, and the configured minimum. This rule does not change the existing `control-inset` check.

## Optional icon sizes

Use `iconSizeRules` in `ui-policy.json` to require specific sizes for selected icons. The default is an empty list. No icon-size checks run until you add a rule.

```json
{
  "iconSizeRules": [
    { "selector": ".sidebar-row .icon", "sizes": [18] },
    { "selector": ".toolbar .icon", "sizes": [16, 20] }
  ]
}
```

The first rule whose `selector` matches a visible element applies. Each size is a positive, finite CSS pixel value for a square icon. Both rendered dimensions must match the same allowed size, with a 0.1 px tolerance. A list of `[16, 20]` allows 16 by 16 px or 20 by 20 px, not 16 by 20 px.

The check measures element boxes, including borders and transforms. It works with selected SVG, image, and HTML elements. It does not measure the artwork inside an SVG view box or a pseudo-element. Hidden elements and selectors with no visible matches are skipped. Do not select rectangular icons unless they must use a square box.

An `icon-size` finding includes the measured width and height and the configured sizes. Icon sizes do not change the minimum control hit area. An 18 px icon can sit inside a larger button.

## Development

All source, tests, examples, and build scripts use strict TypeScript. Run `npm ci`, then:

```sh
npm run typecheck
npm test
npm run test:playwright
npm run demo
```

`npm run build` writes JavaScript, source maps, type declarations, and demo assets to `dist/`.
The package exports built JavaScript and generated types for `lintapple` and `lintapple/playwright`.
Node.js users do not need a TypeScript loader. Run `npm run release:build` to prepare the demo and package for release.

## License

MIT. See [LICENSE](https://github.com/gholtzap/lintapple/blob/main/LICENSE).
