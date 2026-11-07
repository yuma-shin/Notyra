/** An OS deep link that Rust has validated; it is a request, never installation consent. */
export interface PluginInstallRequest {
  requestId: number
  repo: string
  pluginId: string
}
