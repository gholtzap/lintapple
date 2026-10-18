export interface CliResult { code: number | null; stdout: string; stderr: string }
export interface PlaywrightReport {
  errors: { message?: string }[];
  suites: { specs: { title: string; ok: boolean; tests: { results: { attachments: { name: string; contentType: string; body?: string; path?: string }[]; errors: { message: string }[] }[] }[] }[] }[];
}
declare global {
  interface Window {
    axe: { sentinel: string };
    __lintappleWidgetState: string;
    writeText: typeof navigator.clipboard.writeText;
    previewIdentity: string;
    transitionCount: number;
    scrollSamples: number[];
    sampleScroll: boolean;
  }
}
