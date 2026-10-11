export function formatCliError(error, { url, initializing = false } = {}) {
  if (error.code === 'ENOSPC' || error.message.includes('ENOSPC'))
    return 'Not enough disk space. Free disk space, then run the command again.';
  if (error.code === 'ENOENT') {
    if (initializing && error.path === 'package.json')
      return 'No package.json in this directory. Run lintapple init from your project directory.';
    return `Cannot find ${JSON.stringify(error.path)}. Check the file path.`;
  }
  if (error.message.includes('net::ERR_CONNECTION_REFUSED'))
    return `Cannot connect to ${url}. Check that the server is running and the address and port are correct.`;
  if (error.code === 'ERR_INVALID_URL')
    return `Expected a page URL, received ${JSON.stringify(error.input)}.\nInclude http://, https://, or file://.\nExample: lintapple http://localhost:3000\nRun lintapple --help for usage.`;
  return error.message;
}
