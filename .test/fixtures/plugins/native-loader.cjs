// Evaluate fixture ESM with Node's loader instead of Vitest's VM loader.
exports.load = async (url, host) => {
  globalThis.__NOTYRA_FIXTURE_HOST__ = host
  try {
    return await import(url)
  } finally {
    delete globalThis.__NOTYRA_FIXTURE_HOST__
  }
}
