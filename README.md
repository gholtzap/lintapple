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
