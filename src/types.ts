import type { Page, Locator } from 'playwright';
import type { createVisibility } from './visibility.js';
import type { auditAccessibility } from './accessibility.js';
import type { finding } from './report.js';

declare const page: Page;

export type RuleId = (typeof import('./index.js').ruleIds)[number];
export interface Policy {
  fonts: string[];
  fontSizes: number[];
  typeRules: { selector: string; sizes: number[] }[];
  minControlSize: number;
  controlSizeRules: { selector: string; minSize: number; minViewportWidth?: number; maxViewportWidth?: number }[];
  minControlGap: number;
  minControlInset: number;
  controlContainers: string[];
  minLayoutGap: number;
  bannedCopy: string[];
  viewports: { width: number; height: number }[];
  colorSchemes: ('light' | 'dark')[];
  exceptions: { selector: string; rules: RuleId[]; reason: string }[];
}
export type Status = 'passed' | 'failed' | 'unresolved';
export interface FindingDetails {
  selector?: string;
  relatedSelector?: string;
  status?: Status;
  category?: 'accessibility' | 'design';
  sourceRule?: string;
  helpUrl?: string;
  phase?: string;
  focusSelector?: string;
  outcomeSelector?: string;
  contrastRatio?: number;
  requiredContrastRatio?: number;
  foreground?: string;
  background?: string;
  state?: string;
}
export interface Finding extends FindingDetails {
  rule: RuleId;
  selector: string;
  message: string;
  actual: string;
  expected: string;
  fix: string;
}
export interface SuppressedFinding { rule: RuleId; selector: string; reason: string; state?: string }
export interface InteractionCheck extends FindingDetails { rule: RuleId; selector: string; status: Status }
export interface AccessibilityCoverage { pageRules: RuleId[]; interactionRules: string; interactions?: InteractionCheck[] }
export interface PageReport {
  findings: Finding[];
  suppressed: SuppressedFinding[];
  accessibilityCoverage: AccessibilityCoverage;
  elements: number;
  controls: number;
  insetControls: number;
  numericElements: number;
  alignmentGroups: number;
  radiusContracts: number;
}
export interface StateReport extends PageReport { name: string; url: string }
export interface InteractionReport { findings: Finding[]; suppressed: SuppressedFinding[]; checks: InteractionCheck[]; states: StateReport[] }
export interface UrlReport {
  url: string;
  rules: readonly RuleId[];
  runs: (Omit<PageReport, 'findings'> & { viewport: Policy['viewports'][number]; colorScheme: 'light' | 'dark'; states: StateReport[] })[];
  findings: (Finding & { viewport: Policy['viewports'][number]; colorScheme: 'light' | 'dark' })[];
}
export type AddFinding = (rule: RuleId, element: Element, actual: string, expected: string, fix: string, related?: Element | null, details?: FindingDetails) => void;
export type Key = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End' | 'Enter' | 'Space' | 'Escape' | 'Tab' | 'Shift+Tab';
export interface CheckedState { selector: string; value: boolean | 'mixed' }
export interface TabStep { key: Key; focus: string; selected: string }
export interface MenuStep { key: Key; focus: string; checked?: CheckedState[]; outcome?: string; expectedText?: string }
export interface Tabs { selector: string; steps: TabStep[] }
export interface Menu { selector: string; open?: string; openKey?: 'Enter' | 'Space' | 'ArrowDown' | 'ArrowUp'; steps: MenuStep[] }
export interface Ready { selector: string; state?: 'visible' | 'hidden'; expectedText?: string }
export type NamedState = { name: string; selector: string; ready: Ready } & ({ action: 'click' | 'hover' } | { action: 'fill'; value: string } | { action: 'press'; key: string });
export interface InteractionPlan {
  focus: { selector: string }[];
  buttons: { selector: string; key: 'Enter' | 'Space'; outcome: string; expectedText: string }[];
  tooltips: { trigger: string; tooltip: string }[];
  dialogs: { open: string; dialog: string; close: string; returnFocus?: string }[];
  tabs: Tabs[];
  menus: Menu[];
  states: NamedState[];
  timeout: number;
  maxTabStops: number;
}
export interface CheckOptions { ready?: string; timeout?: number; interactions?: Partial<InteractionPlan> }
export type Visibility = ReturnType<typeof createVisibility>;
export type RecordCheck = (rule: RuleId, selector: string, passed: boolean, actual: string | undefined, expected: string, fix: string, details?: FindingDetails) => Promise<void>;
export type Wait = <Arg>(fn: Parameters<typeof page.waitForFunction<unknown, Arg>>[0], argument: Arg) => Promise<boolean>;
export interface WidgetHelpers {
  target: (selector: string) => Promise<Locator>;
  record: RecordCheck;
  wait: Wait;
  reach: (locator: Locator) => Promise<boolean>;
  shown: (selector: string) => Promise<boolean>;
  hidden: (selector: string) => Promise<boolean>;
  inspect: (name: string) => Promise<void>;
  createVisibility: typeof createVisibility;
}
export interface SvgContrast {
  selector: string;
  required: number;
  status: Status;
  reason?: string;
  contrastRatio?: number;
  fgColor?: string;
  bgColor?: string;
  pixels?: number;
}
export interface ContrastData { expectedContrastRatio?: string; contrastRatio?: number; fgColor?: string; bgColor?: string }
// axe exposes these browser primitives at runtime but omits them from its public declarations.
export interface Color { alpha: number; parseString(value: string): Color; toHexString(): string }
export interface AxeNode { element: Element; any: AxeCheck[]; all: AxeCheck[]; none: AxeCheck[]; failureSummary?: string }
export interface AxeCheck { id: string; message?: string; data?: ContrastData & { messageKey?: string } }
export interface AxeResult { id: string; nodes: AxeNode[]; description: string; help: string; helpUrl: string }
export interface AxeEngine {
  run(context: Document, options: { runOnly: string[]; iframes: boolean; elementRef: boolean; rules?: Record<string, { enabled: boolean }>; resultTypes: string[] }): Promise<{ violations: AxeResult[]; incomplete: AxeResult[] }>;
  configure(options: { checks: { id: string; options: { ignoreUnicode: boolean; ignoreLength: boolean; ignorePseudo: boolean; boldValue: number; boldTextPt: number; largeTextPt: number; contrastRatio: { normal: { expected: number }; large: { expected: number } }; pseudoSizeThreshold: number; shadowOutlineEmMax: number; textStrokeEmMin: number } }[] }): void;
  setup(document: Document): void;
  teardown(): void;
  commons: { dom: { isVisibleOnScreen(el: Element): boolean }; text: { visible(el: Element): string }; color: { Color: new () => Color; getBackgroundColor(el: Element): Color | null; flattenColors(fg: Color, bg: Color): Color; getContrast(bg: Color, fg: Color): number } };
}
export interface AccessibilityInput { elements: Element[]; controls: Element[]; visible: Visibility['visible']; hasVisibleContent: Visibility['hasVisibleContent']; add: AddFinding; engine: AxeEngine }
export interface AuditInput { policy: Policy; contrast: AxeEngine; accessibility: typeof auditAccessibility; format: typeof finding; visibility: Visibility; svgContrast?: SvgContrast[] }
