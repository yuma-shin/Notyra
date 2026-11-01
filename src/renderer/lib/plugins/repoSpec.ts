export type RepoSpec = { owner: string; repo: string }
export type RepoSpecError = { error: 'empty' | 'format' }

const SHORT_FORM = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/
const URL_FORM =
  /^https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/

/**
 * リポジトリ指定を解析する。
 * `owner/repo` または `https://github.com/owner/repo`（末尾の `.git` と `/` を許容）を受け付ける。
 * 前後の空白は除去し、空（空白のみを含む）は `empty`、いずれの形式にも一致しない場合は `format` を返す。
 */
export function parseRepoSpec(input: string): RepoSpec | RepoSpecError {
  const value = typeof input === 'string' ? input.trim() : ''
  if (value === '') {
    return { error: 'empty' }
  }
  const match = SHORT_FORM.exec(value) ?? URL_FORM.exec(value)
  // GitHub は `.` と `..` をリポジトリ名として許可しない。API の URL パスを壊さないよう拒否する
  if (!match || match[2] === '.' || match[2] === '..') {
    return { error: 'format' }
  }
  return { owner: match[1], repo: match[2] }
}
