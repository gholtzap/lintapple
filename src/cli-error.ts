export function formatCliError(error: unknown, { url, initializing = false }: { url?: string; initializing?: boolean } = {}) {
  if (!(error instanceof Error)) return String(error);
  const detail = error as NodeJS.ErrnoException & { input?: string };
  if (detail.code === 'ENOSPC' || error.message.includes('ENOSPC'))
    return 'Not enough disk space. Free disk space, then run the command again.';
  if (detail.code === 'ENOENT') {
    if (initializing && detail.path === 'package.json')
      return 'No package.json in this directory. Run lintapple init from your project directory.';
    return `Cannot find ${JSON.stringify(detail.path)}. Check the file path.`;
  }
  if (error.message.includes('net::ERR_CONNECTION_REFUSED'))
    return `Cannot connect to ${url}. Check that the server is running and the address and port are correct.`;
  if (detail.code === 'ERR_INVALID_URL')
    return `Expected a page URL, received ${JSON.stringify(detail.input)}.\nInclude http://, https://, or file://.\nExample: lintapple http://localhost:3000\nRun lintapple --help for usage.`;
  return error.message;
}
