export type ExampleState = 'before' | 'after';
export interface DemoRule {
  id: string;
  title: string;
  group: 'Typography' | 'Layout' | 'Color' | 'Content';
  summary: string;
  fix: string;
  html: string;
  before: string;
  after: string;
  attributes?: Partial<Record<ExampleState, Record<string, Record<string, string | null>>>>;
}
declare global {
  interface Window { setExampleState?: (state: ExampleState) => void }
}
