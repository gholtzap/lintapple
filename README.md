# lintapple

Check a rendered page against fixed design rules. No AI model, screenshot baseline, or remote service is required. Each error includes a rule ID, a CSS selector, the measured value, the expected value, and a suggested fix.

The checker enforces a design policy. It cannot guarantee a good design.

## Add to your project

Requires Node.js 22 or later. Run these commands from the project directory.

```sh
npm install -D lintapple
npx lintapple init
```

Setup creates `ui-policy.json` and adds a `lint:ui` script to `package.json`. It keeps an existing policy and an existing script. Set the policy's fonts and text sizes to match your design. Set your app's URL in the script; the initial URL is `http://localhost:3000`.

### Command-line checks

Start your app, then run:

```sh
npm run lint:ui
```

To try a page without project setup:

```sh
npx lintapple http://localhost:3000
```

The CLI downloads Chromium on its first run if it is absent, then reuses it. Linux CI can need browser system libraries; use `npx playwright install --with-deps chromium` in the CI setup.

The CLI reads `ui-policy.json` in the working directory. If the file is absent, it uses the package defaults. Use `--config path` to select another policy. An invalid or unreadable policy fails the check.

For content that loads after navigation, use `--ready '[data-app-ready]'`. The selector must be visible when the interface is ready.

Exit codes: `0` means pass, `1` means UI findings, and `2` means the check could not finish. Use `--json` for the full report.

### Existing Playwright tests

Add the helper to a test after the page reaches the required state:

```js
import { test } from '@playwright/test';
import { expectUI } from 'lintapple/playwright';

test('new project dialog', async ({ page }, testInfo) => {
  await page.goto('/projects');
  await page.getByRole('button', { name: 'Add project' }).click();
  await page.getByRole('dialog').waitFor();
  await expectUI(page, testInfo);
});
```

The helper reads `ui-policy.json` from the test process's working directory. Pass a policy as the third argument to use it instead. The helper uses your test's browser, viewport, and login state. Findings fail the test and attach a JSON report. Keep your existing Playwright configuration; [report setup](#playwright-reports) uses its HTML and GitHub reporters.

### Which checks need markup?

Font, text size, contrast, accessible names, labels, control size, viewport bounds, and clipping checks work on existing HTML. Spacing between sibling buttons also works without extra attributes.

Stack spacing, alignment, changing numbers, nested corners, and text containment need the [layout attributes](#small-layout-primitives). You can use your existing CSS and components. Set `controlContainers` in the policy to select existing button containers.

### Work on the checker

```sh
npm ci
npx playwright install chromium
npm test
npm run test:playwright
```

The `ui-lint` command remains available for existing installations. Tests run the real CLI and browser on valid and invalid pages. Reports are saved in `test-results/`.

## Rule demo

The demo uses the layout of [Craft](https://craft.gustavofior.com/) to show interface rules from this repo. Each rule page has a before example, an after example, and the fix code.

```sh
npm run demo
# Open http://localhost:4173/demo/
```

Select Before or After on a card, or select the rule title to compare both states. The demo starts in dark mode. The theme button changes the page and examples between light and dark themes.

The demo uses [Lenis](https://lenis.dev/) for smooth wheel scrolling. It respects the reduced-motion setting and keeps native touch and sidebar scrolling. Rule changes return to the top immediately. The local server and release build use the pinned Lenis files from `node_modules`.

In Contained text, drag the canvas's lower-right corner or use the width slider. Before text extends past the card edge. After text wraps inside the card.

```sh
npm run demo:check
```

This command checks each example as a main document at 248, 330, 390, and 1440 px in both themes. Before pages must fail their named rule. After pages must have no findings. It saves the actual results in `demo/reports.json`. It also checks the index, each rule detail, theme controls, and open mobile navigation at 390, 768, and 1440 px. The policy and exceptions stay unchanged.

The gallery uses iframes to keep each example's CSS separate. The checker does not inspect iframe content from the parent page. The direct example checks are required. Saved check results are in `demo/reports.json`; the site does not load or show them.

## Policy

Edit `ui-policy.json` to state your design decisions. Fonts, general font sizes, sizes by text role, minimum control size, control gaps, control insets, container selectors, component gaps, prohibited phrases, viewports, and color schemes are configurable.

The default font is the system sans-serif font. The checker tests the first family in the computed CSS font stack. It also detects failed requested font files. It does not prove which font rendered each glyph or whether that font supports tabular figures.

The first matching `typeRules` selector defines the sizes for an element and its text descendants. General `fontSizes` apply elsewhere. Text in `pre`, `code`, `kbd`, and `samp` is excluded from font and copy checks.

Default thresholds are project choices. The 15 px minimum control size and 8 px gaps are not claims from Craft or accessibility certification.

Use `controlSizeRules` for controls that need a different minimum size. The first rule that matches the control and the viewport width applies. The width bounds are inclusive and optional. Other controls use `minControlSize`. A size rule does not exclude gap, inset, or clipping checks.

```json
{
  "minControlSize": 32,
  "controlSizeRules": [
    { "selector": "[role=tab]", "minSize": 24, "minViewportWidth": 760 }
  ]
}
```

For light and dark checks, set `colorSchemes` to `["light", "dark"]`. This tests CSS that responds to the browser color preference. Use the page API below for a theme controlled by the app.

## Rules

| Rule | Contract |
| --- | --- |
| `font-family` | Visible interface text uses an approved first CSS font family. |
| `font-size` | Visible interface text uses an approved size for its role. |
| `font-loading` | Requested font files do not have a load error. |
| `control-size` | Buttons and button-role elements meet the minimum width and height. |
| `control-gap` | Sibling buttons, or buttons in a marked action group, have the minimum measured gap. Overlap fails too. |
| `control-inset` | Buttons stay at least 8 px from each inner edge of their nearest configured container. The minimum is configurable. Borders do not count as padding. |
| `layout-gap` | Visible direct children of a marked stack have the minimum measured gap. |
| `layout-alignment` | Marked elements share a horizontal start edge, center, or end edge within 1 px. |
| `copy` | Visible text has no configured prohibited phrase, including phrases split across inline elements. |
| `tabular-numbers` | Marked changing values and inferred numeric table cells request tabular figures. |
| `numeric-alignment` | Inferred numeric table cells are right aligned. |
| `nested-radius` | A marked inner surface uses the outer radius minus the measured inset, with a minimum of zero. |
| `root-background` | `html` has an explicit background color with nonzero opacity. |
| `horizontal-overflow` | The document has no horizontal overflow beyond a 1 px tolerance. |
| `viewport-bounds` | Rendered elements and text stay inside the screen horizontally. Fixed elements and open dialogs or overlays also fit vertically. |
| `content-clipping` | Text line boxes fit inside ancestors that use `overflow: hidden` or `clip`. |
| `content-overflow` | Visible text stays inside its nearest `data-ui-content` container, with a 1 px tolerance. Local scrolling inside that container is allowed. |
| `text-contrast` | Normal text has at least 4.5:1 contrast. Large text has at least 3:1. Unresolved calculations also produce a finding. |
| `accessible-name` | Controls have an accessible name. |
| `form-label` | Form fields have a programmatic label. A placeholder alone is insufficient. |
| `aria-reference` | ARIA references identify existing elements. A collapsed popup can create its controlled element when opened. |
| `label-consistency` | The accessible name includes the visible control label. |

These rules run through `checkPage`, `checkUrl`, and the `lintapple` command. Alignment needs the markers described below. Text containment needs `data-ui-content`. Clipping and the four listed accessibility rules need no checker-specific attributes. Removing a rule from the demo does not disable it in the checker.

### Small layout primitives

`examples/ui.css` provides `.ui-stack`, `.ui-actions`, `.ui-panel`, and `.ui-surface`. Use these to make safe spacing and radius values the default. Add the matching attributes so the checker can verify their meaning:

```html
<main class="ui-stack" data-ui-stack>
  <h1>Projects</h1>
  <div class="ui-actions" data-ui-actions data-ui-container>
    <button>Add project</button>
    <button>Export</button>
  </div>
  <span data-ui-number>12,441</span>
  <section class="ui-panel" data-ui-radius>
    <div class="ui-surface" data-ui-radius-inner>Content</div>
  </section>
</main>
```

The radius contract is for a visible direct child, equal insets, and equal circular pixel radii. It includes the parent border in the measured inset. Uniform scale is supported: radii and insets are compared in rendered pixels, with a 1 px tolerance. Nonuniform scale produces elliptical corners and fails the circular radius contract. Unsupported shapes fail the contract. Do not mark surfaces whose corners do not follow each other.

Gap checks compare child boxes that overlap along one axis. They support rows, columns, wrapping, and grids. They do not judge diagonal spacing or arbitrary relationships between unmarked components.

### Layout alignment

Use `data-ui-align="start"`, `"center"`, or `"end"` on a group. Mark at least two elements with `data-ui-align-item`. The first visible marked element is the reference. The checker compares the rendered boxes, even when an element is inside a padded wrapper.

```html
<section data-ui-align="start">
  <p data-ui-align-item style="margin-inline:8px">Edit project</p>
  <div class="ui-actions" data-ui-actions data-ui-container>
    <button data-ui-align-item>Cancel</button>
    <button>Save</button>
  </div>
</section>
```

The heading margin matches the existing action container's 8 px padding. This keeps the heading aligned with the button edge and preserves the control inset.

`start` and `end` use the group's text direction. Hidden and inert items are excluded. Each item belongs to its nearest marked group, so nested groups are checked separately. A group with fewer than two visible items has no measured alignment check. Invalid alignment values or fewer than two declared items produce a finding. `alignmentGroups` in the report counts groups with at least two visible items.

This rule checks only marked element boxes. It does not compare glyph edges, text baselines, or optical alignment. Use it for axis-aligned elements. Mark only the items that must align; other layouts remain valid.

The group wrapper can use `display: contents` or have no height. Its visible marked items still receive alignment checks.

### Control insets

Mark the containing surface with `data-ui-container`. Every visible descendant button is checked against its nearest configured ancestor, including buttons inside wrapper elements. The report names the button, the container, the failing edge, and the measured distance. Absolute positioning, negative margins, and translated buttons cannot hide a small inset behind a CSS padding declaration.

```html
<div data-ui-container style="padding:8px">
  <button aria-label="More">+</button>
</div>
```

Use `controlContainers` to select existing surfaces without adding attributes. For example:

```json
{
  "minControlInset": 8,
  "controlContainers": ["[data-ui-container]", ".panel", "dialog"]
}
```

The rule measures all four edges of the container's client box, excluding borders and scrollbars. A negative distance means the button extends past an edge. It supports axis-aligned boxes, including scaled containers. Rotated or skewed containers are outside this geometry contract. For scrollable surfaces, check the relevant scroll state or use an appropriate selector for each visible control group. Unmarked containers that do not match a configured selector are not checked.

`insetControls` in each report run states how many buttons this rule checked. Use a scoped `control-inset` exception, with a reason, for a control that is intentionally attached to an edge.

### Screen bounds and clipped text

`viewport-bounds` runs without markers. It checks rendered element boxes and text line boxes against the CSS layout viewport, with a 1 px tolerance. Normal page content can extend below the screen and remain available through vertical scrolling. Fixed elements, open `dialog` elements, and elements with `role="dialog"`, `role="alertdialog"`, or `data-ui-overlay` must fit vertically too. Their descendants must fit unless a local scroll region provides access to that content.

Local regions with `overflow: auto` or `scroll` can contain wider or taller content. The scroll region itself must fit the screen. An absolute-positioned element can escape a scroll ancestor when its containing block is outside that ancestor. That ancestor does not exempt the element from bounds checks. Page-level scrolling does not exempt horizontal overflow. Content clipped by an inner container is checked against its painted bounds for viewport errors. Root overflow hiding does not hide a screen-bound error.

Mark an HTML text container with `data-ui-content` to check visible text against its inner edges. `content-overflow` checks the nearest marked container, including text that stays on screen but extends past a card edge. Borders do not count as space for text. Wrapping and local scrolling inside the marked container are allowed. Scrolling outside that container does not permit text to escape it.

`content-clipping` measures direct DOM text nodes with browser Range rectangles and compares each text line to the client box of clipping ancestors. It includes inline wrappers, long words, ellipsis, and line clamping. Borders do not enlarge the clipping area. Normal scrollable content is allowed. An intentionally truncated label needs a scoped exception and a reason:

```json
{
  "exceptions": [
    {
      "selector": ".short-label",
      "rules": ["content-clipping"],
      "reason": "The full label is available in the detail view."
    }
  ]
}
```

These are DOM geometry checks. Text painted by pseudo-elements, native input values, SVG internals, images, and canvas pixels is not measured as text. Arbitrary clip paths, masks, rotated clipping containers, transformed containing blocks for fixed elements, and mobile keyboard resizing are outside the current contract. They do not detect content hidden behind another element. Test the states that contain long labels, menus, and dialogs.

### Text contrast

The `text-contrast` rule uses the pinned axe-core contrast engine. It follows [WCAG contrast minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html): 4.5:1 for normal text and 3:1 for large text. Large text is at least 24 CSS px, or about 18.67 CSS px with a font weight of at least 700. The pass decision uses the calculated ratio. The displayed ratio is truncated to two decimal places.

The engine handles inherited backgrounds, transparent colors, opacity groups, and many overlapping layers. The checker also tests visible empty-input placeholders with axe-core's color and background utilities. Placeholder effects involving ancestor opacity, filters, blend modes, or text shadows produce an unresolved finding instead of an estimated pass. Disabled controls are excluded from the contrast requirement.

Visible direct text is checked even when its element has no layout box, such as `display: contents`. Boxless text uses the engine's color utilities and a containing ancestor background. Effects, overlapping boxes, or backgrounds that cannot be measured produce an unresolved finding. Hidden and inert text is excluded.

Findings have `status: "failed"` for measured failures, with `contrastRatio`, `requiredContrastRatio`, `foreground`, and `background`. Cases that the engine cannot measure have `status: "unresolved"` and an explanation. Both statuses fail the CLI with exit code `1`. Background images, complex effects, and some gradients can require review. Use the existing scoped exception format to record the reason after review.

The rule runs in the state supplied to the checker. Test hover, focus, themes, and open dialogs when those states change colors. It does not certify the whole site for accessibility. The main-document scope remains in effect. An app's own `window.axe` object is preserved.

### Exceptions

Exceptions require a reason and specific rule IDs:

```json
{
  "exceptions": [
    {
      "selector": ".segmented-control > button",
      "rules": ["control-gap"],
      "reason": "These buttons form one joined control."
    }
  ]
}
```

The JSON report lists excluded findings and their reasons for each run. An exception applies to the element named in the finding. It does not apply to all descendants.

## Craft sources

The first Craft rules come from published articles:

- [Tabular numbers](https://craft.gustavofior.com/tabular-numbers): stable digits for changing values and right-aligned numeric columns.
- [Nested border radius](https://craft.gustavofior.com/nested-border-radius): inner radius follows the outer radius and inset. The article also explains when this relationship does not apply.
- [HTML background](https://craft.gustavofior.com/html-background): set the document canvas color on the root element.

The font, type scale, spacing, copy, and overflow rules are additional project policy. [Craft's index](https://craft.gustavofior.com/) contains several entries that are not yet published. They are not treated as complete specifications.

Hover timing, optical alignment, icon style, text wrapping quality, and other visual judgments are not checked in this version. The icon-button tooltip requirement is an explicit design rule, separate from accessibility requirements.

## Accessibility and agent controls

Every page check now runs the pinned axe-core engine for accessible names, form labels, visible-label/name consistency, ARIA state validity, hidden focusable controls, and WCAG 2.2 target size. The `target-size` rule uses the engine's size and spacing checks. It does not replace the separate configurable `control-size` design rule or require every target to be 24px. Some exceptions need review. See [WCAG target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).

The new rule IDs are `accessible-name`, `form-label`, `aria-reference`, `label-consistency`, `control-state`, `keyboard-operation`, `focus-visible`, `focus-obscured`, `dialog-focus`, `icon-button-tooltip`, and `target-size`.

Accessibility findings include `category: "accessibility"` and `status: "failed"` or `"unresolved"`. Tooltips use `category: "design"`. An unresolved finding needs review; it is not a measured failure or a pass. Both statuses make the CLI exit 1. Existing selector-based exceptions apply to each new rule.

Buttons and links need accessible names. Use native HTML and visible labels where possible. An icon button can use `aria-label`, `aria-labelledby`, or visually hidden text. A form field needs a programmatic label; a placeholder or title alone does not meet this linter's form-label rule. Good roles, names, and states also let agents find controls by their meaning. The checker cannot decide whether a nonempty name accurately describes an action.

For an icon button, provide a text tooltip as well as an accessible name:

```html
<button type="button" aria-label="Delete message" aria-describedby="delete-tip">
  <svg aria-hidden="true"><!-- Icon from your icon library --></svg>
</button>
<span id="delete-tip" role="tooltip" hidden>Delete message</span>
```

`aria-describedby` supplies a description, not a replacement for the button name. `data-ui-tooltip="delete-tip"` is also accepted as a visual tooltip contract. The page check verifies a tooltip reference, role, and text. The interaction check verifies hover, keyboard focus, Escape dismissal, and retained trigger focus. A `title` attribute alone does not meet the tooltip design rule. Visually hidden labels and symbol-only labels do not count as visible button text. Disabled buttons are excluded from the tooltip design rule. See [accessible names](https://www.w3.org/WAI/ARIA/apg/practices/names-and-descriptions/) and [tooltips](https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/).

Mark disclosure buttons with `data-ui-disclosure`, set `aria-controls`, and update `aria-expanded` with panel visibility. Menu buttons and ARIA widgets also receive their applicable state checks. A collapsed popup may create its panel when opened; an engine result for that missing panel is reported as unresolved when the engine cannot decide. Unique references to existing `role="menu"` targets resolve the engine's popup-reference uncertainty. Missing, ambiguous, or wrong-role targets still require review. Check the open state as well.

Panel visibility includes visible child content. A panel with `display: contents` or zero height can still be expanded when its children are visible.

The normal CLI does not activate buttons, open dialogs, or change keyboard focus. Use an explicit interaction plan for these checks, with stable test data and actions that are safe to execute:

```json
{
  "focus": [{ "selector": "#save" }],
  "tooltips": [{ "trigger": "#delete", "tooltip": "#delete-tip" }],
  "buttons": [{ "selector": "#save", "key": "Enter", "outcome": "#status", "expectedText": "Saved" }],
  "dialogs": [{ "open": "#edit", "dialog": "#edit-dialog", "close": "#cancel" }],
  "timeout": 1500,
  "maxTabStops": 100
}
```

```sh
node bin/lintapple.js http://localhost:3000 --interactions interactions.json --json
```

Or call `checkInteractions(page, plan, policy)` from Playwright. It returns `findings`, `suppressed`, `checks`, and `states`. Plans use CSS selectors in the main document. Each action selector must identify one element when used. A tooltip element must exist before its check. A dialog can be created by its open action. Plans run focus checks, tooltips, buttons, dialogs, tabs, menus, then named states in the listed order and change the page state. Use fresh fixtures or reset the page between separate plans.

Existing plans now run `checkPage()` after keyboard focus, tooltip hover and focus, tooltip dismissal, button activation, and dialog open and close. State names identify the plan item and phase, such as `buttons[0]: Enter` or `dialogs[0]: open for button`. Internal Tab navigation remains part of the keyboard behavior check.

Button checks require `Enter` or `Space` and a declared result element with exact trimmed text. That text must not already be present before activation, so a stale success message cannot produce a pass. Test both keys in separate reset states for custom buttons. The plan activates each listed button once. Each dialog plan opens the dialog twice: once to test its close button and once to test Escape. It checks initial focus, forward and backward focus containment, and focus return. `returnFocus` can name a different logical workflow target. Moving to browser controls is not treated as focus escaping into background page content. See [modal dialog guidance](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/).

Focus checks use real Tab navigation. The computed-style check detects common outlines, shadows, and color changes; a missing detectable indicator is unresolved because custom painted indicators need visual review. Occlusion checks use viewport bounds and hit-test samples. A fully covering opaque box is a failure; other covered samples are unresolved. These checks cannot prove indicator contrast or detect every painted overlay.

### Tabs and menus

Add `tabs` and `menus` to an interaction plan to check composite widgets with real keyboard input. Each widget needs a `selector` and 1 to 100 `steps`. Each step declares a key and the expected focus selector. Each selector must identify one element in the main document when the step runs.

```json
{
  "tabs": [{
    "selector": "#case-tabs",
    "steps": [
      { "key": "ArrowRight", "focus": "#records-tab", "selected": "#overview-tab" },
      { "key": "Enter", "focus": "#records-tab", "selected": "#records-tab" },
      { "key": "ArrowLeft", "focus": "#overview-tab", "selected": "#records-tab" },
      { "key": "Space", "focus": "#overview-tab", "selected": "#overview-tab" }
    ]
  }],
  "menus": [{
    "selector": "#case-menu",
    "open": "#case-actions",
    "openKey": "Enter",
    "steps": [
      { "key": "ArrowDown", "focus": "#show-notes" },
      { "key": "Space", "focus": "#show-notes", "checked": [{ "selector": "#show-notes", "value": true }] },
      { "key": "Escape", "focus": "#case-actions" }
    ]
  }]
}
```

This tab example uses manual activation. For automatic activation, set `selected` to the newly focused tab after each arrow key. The checker requires one selected tab, valid `aria-selected` values, and linked, labelled tab panels whose visibility matches selection. Every tab step needs a `selected` selector, including steps that leave the tab list. Enter and Space must select the focused tab.

Menu plans can check popup menus, menubars, and nested menus inside the declared widget. A popup menu must start closed. `open` names its keyboard-reachable opener. `openKey` defaults to `Enter`; `Space`, `ArrowDown`, and `ArrowUp` are also accepted. Opening must focus the first item, or the last item for `ArrowUp`. Omit `open` for a widget that is already open or a menubar. The checker verifies the opener's `aria-haspopup` and `aria-expanded` states and each submenu's expanded state against visibility.

The accepted step keys are `ArrowLeft`, `ArrowRight`, `ArrowUp`, `ArrowDown`, `Home`, `End`, `Enter`, `Space`, `Escape`, `Tab`, and `Shift+Tab`. Declare the keys and results required by your widget: horizontal or vertical movement, wrapping or stopping at the end, optional Home and End keys, submenu entry and return, and Escape dismissal. Both direct item focus and `aria-activedescendant` on a containing focused element are supported. The checker does not insert focus with JavaScript to make a step pass.

For checkbox or radio activation, `checked` must include the activated item and its expected value. Use booleans, or `"mixed"` for a checkbox. For an enabled checkbox, the expected state must differ before activation. For an enabled radio item, activation must set its checked state to true. Radio checks also reject multiple checked items in a group. Groups use `role="group"`, or separators within the same menu. Navigation keys must keep existing checked states unchanged. To verify an action item, declare `outcome` and `expectedText`, as in button plans. The result must differ before activation. A submenu action can instead declare focus on its child item. An action without a result cannot prove activation and is rejected.

Findings use the existing `keyboard-operation` and `control-state` rules, scoped exceptions, and coverage reports. Page checks also run after menu opening and each key step. Steps stop after a focus failure so that later keys cannot activate unrelated controls. The checker tests only declared keys and states; it does not prove complete widget behavior. It checks DOM descendants in the main document, not shadow roots, frames, or items attached through `aria-owns`. Use separate plans for separate popup menus. See the W3C [tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/), [menu and menubar](https://www.w3.org/WAI/ARIA/apg/patterns/menubar/), and [menu button](https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/) patterns.

Exit checks inspect the current menu after Escape, Tab, or Shift+Tab. A visible replacement cannot pass because the old node was removed. Give nested menus stable IDs if the app removes or replaces them. A removed nested menu without an ID produces an unresolved result because the checker cannot identify its replacement.

`accessibilityCoverage` records the page rules and the explicit interaction checks. Without a plan, interaction behavior is marked untested. A passing page check does not prove keyboard or dialog behavior or full accessibility. Check each route and relevant state.

## App states and CI

The CLI checks the initial page and each planned state at every configured viewport and color preference. Add `states` to an existing interaction plan to check a workflow after each declared action:

```json
{
  "states": [
    { "name": "Menu open", "action": "click", "selector": "#options", "ready": { "selector": "#menu" } },
    { "name": "Menu closed", "action": "press", "selector": "#options", "key": "Escape", "ready": { "selector": "#menu", "state": "hidden" } },
    { "name": "Dialog open", "action": "click", "selector": "#edit", "ready": { "selector": "#editor" } },
    { "name": "Form error", "action": "click", "selector": "#save", "ready": { "selector": "#error", "expectedText": "Enter a project name." } },
    { "name": "Form filled", "action": "fill", "selector": "#project-name", "value": "Research", "ready": { "selector": "#error", "state": "hidden" } },
    { "name": "Saved result", "action": "click", "selector": "#save", "ready": { "selector": "#saved", "expectedText": "Saved Research" } }
  ]
}
```

Actions support `click`, `hover`, `fill` with a string `value`, and `press` with a Playwright `key`. Each step needs a unique name, an action selector, and a ready selector. Names can contain at most 100 characters. `initial` and generated interaction names are reserved. Plans can contain at most 100 named steps. Ready selectors wait for `visible` by default, or `hidden` when specified. An optional `expectedText` must exactly match the visible element's trimmed text. A hidden ready element can be removed from the page. Other ready selectors must match one element.

The checker waits for readiness, then runs all page rules with the same policy and exceptions. Each action must have its own step so that later actions cannot hide an earlier error. A missing or ambiguous target, readiness timeout, or page-check timeout stops the run with exit 2. Findings in any checked state produce exit 1. A completed run with no findings produces exit 0. The plan's `timeout` controls actions and readiness; page checks use the CLI's 15-second limit. The API can set that limit with `checkInteractions(page, plan, policy, { timeout: 15000 })`.

`checkInteractions()` returns each page report in `states`, with its name, URL, findings, suppressed findings, counts, and coverage. Combined page findings and suppressed page findings include `state`. Behavior findings keep their selector, phase, and status. `checkUrl()` adds `runs[].states`, starting with `initial`, and keeps findings from all states, including errors that a later action removes. Each viewport and color preference starts in a fresh browser context. The text report includes state names and the total number of page checks.

These checks test the UI in the listed states. They do not prove that all workflows were listed or that a saved message means the correct data was stored. Use product assertions for those results.

### Playwright reports

Call `expectUI` after each state change that needs a check. It checks the current page with the same policy and rules as `checkPage`. Set viewports and readiness in your tests.

Findings fail the assertion. The error lists each rule, selector, result, and fix. The helper attaches `lintapple findings` as JSON, with the page URL, viewport, full findings, exclusions, counts, and coverage. Playwright's HTML report shows the attachment. Its GitHub reporter adds an error annotation at the assertion's test line. Invalid policies and execution errors also fail the test; they do not produce a findings attachment. Do not catch assertion errors in your tests.

Add Playwright's built-in reporters to your existing configuration:

```js
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    ...(process.env.GITHUB_ACTIONS ? [['github']] : []),
  ],
  use: { screenshot: 'only-on-failure' },
});
```

Run `npx playwright test`, then `npx playwright show-report` to open the HTML report. In GitHub Actions, upload `playwright-report/` with `actions/upload-artifact` after the test step, including failed runs. The [Playwright reporter documentation](https://playwright.dev/docs/test-reporters) describes both reporters.

This repository includes a working example in `examples/playwright/`. Run `npm run test:playwright`, then `npx playwright show-report test-results/playwright-report`. The workflow in `.github/workflows/playwright.yml` runs that example, emits GitHub annotations for failures, and saves the HTML report.

For direct page checks inside this project, import `checkPage` from `./src/index.js`. The production site also provides a versioned package download:

```sh
npm install https://lintapple-demo.vercel.app/downloads/lintapple-0.1.15.tgz
```

The [production examples](https://lintapple-demo.vercel.app/demo/) cover the design and accessibility rules. `release.json` records the source commit and file checksums. `npm run release:build` makes the static deployment and package in `test-results/production-stage`. The CLI can also run without package installation through `node bin/lintapple.js`.

Make the page checks required in your CI process. Use AGENTS.md to require the AI to use the layout primitives and fix failed checks. Keep policy changes under human review. A prompt alone does not enforce the policy.

Reports are stable for a stable page, policy, browser, fonts, and operating system. Use `npm ci` and the same browser installation in CI. The CLI fixes viewport, color preference, locale, timezone, device scale, and reduced-motion preference. Live data, app timers, asynchronous content, and differences between platforms can still change the result. Use stable test data and a readiness selector.

## Limits

- Checks cover visible DOM elements in the main document. They do not inspect shadow roots, iframes, canvas pixels, pseudo-element text, or off-screen application states.
- Buttons are checked for design hit area and spacing. Accessibility checks also cover named controls and links, with the scope and interaction limits described above.
- A phrase list cannot decide whether all interface text is useful. Approved wording and human review are still needed.
- A valid size can still be a poor design choice. Configure text roles for your product rather than using a broad size list alone.
- Font requests and CSS declarations do not prove the font used for every glyph.
- Radius, numeric, alignment, and control-inset checks need the stated contracts. A missing marker or container selector can leave a semantic check uncovered. The report includes element, control, inset-control, numeric, alignment, and radius counts so you can review coverage.
- Pages with more than 5000 visible elements produce an execution error.

No target app has been integrated with CI yet. The included tests prove the checker on its fixtures, not the design quality of another product.
