# Project rules

Use ASD-STE100 Simplified Technical English.

Before a code change, read the related code. Reuse the report format, policy validation, and geometry checks. Add a new primitive only when it makes the current task simpler or more correct.

Use sentence-case sans-serif text in interfaces. Use monospace only for code, commands, JSON, and identifiers. Do not add all-caps labels or decorative status text.

Before you finish a UI change:

1. Use the approved fonts, text sizes, and layout primitives.
2. Mark component stacks with `data-ui-stack`, action groups with `data-ui-actions`, button containers with `data-ui-container`, changing values with `data-ui-number`, and concentric surfaces with the radius attributes described in README.md. Existing button containers can also be checked with the policy's `controlContainers` selectors.
3. Run the checker on each changed route and relevant interface state. A nonzero exit code means the check has not passed.
4. Fix the interface. Do not change the policy, add exceptions, or remove contract attributes just to make a check pass. A design-policy change needs a user request.
5. Run `npm test` after you change the checker.

Keep elements and text within the horizontal viewport. Fixed elements and open dialogs must also fit vertically. Allow long text to wrap or use a local scroll region. Do not hide overflow to conceal a layout error.

Keep normal text contrast at or above 4.5:1 and large text contrast at or above 3:1. Unresolved contrast findings require review; they are not passes. Check placeholders and color changes on hover and focus.

The checker cannot prove visual quality, correct wording, or test coverage. State which routes and states you checked.
