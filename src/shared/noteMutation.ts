/** Internal editor/backend protocol; separate from filesystem watcher echoes. */
export interface NoteMutation {
  requestId: string
  transactionId: string
  phase: 'prepare' | 'commit' | 'abort'
  kind: 'create' | 'update' | 'rename' | 'move' | 'delete'
  paths: string[]
  newPath: string | null
}
