export type ExampleState = 'before' | 'after';
export interface DemoRule {
  id: string;
  title: string;
  group: 'Typography' | 'Layout' | 'Color' | 'Content';
  summary: string;
  fix: string;
  note?: string;
  html: string;
  before: string;
  after: string;
}
declare global {
  interface Window {
    setExampleState?: (state: ExampleState) => void;
    dismissExampleTooltip?: () => void;
  }
}
