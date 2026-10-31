import semver from 'semver'

const RANGE_OPTIONS = { includePrerelease: true } as const

/**
 * Compatible_Version_Range が Notyra のバージョンを含むかを判定する。
 * node-semver の `satisfies`（includePrerelease 有効）と同じ結果を返す。
 * 範囲が解析できない場合や、入力が不正な場合は例外を送出せず false を返す。
 */
export function isCompatible(range: string, appVersion: string): boolean {
  if (typeof range !== 'string' || typeof appVersion !== 'string') {
    return false
  }
  try {
    if (semver.validRange(range, RANGE_OPTIONS) === null) {
      return false
    }
    return semver.satisfies(appVersion, range, RANGE_OPTIONS)
  } catch {
    return false
  }
}

/**
 * 取得したバージョンがインストール済みのバージョンより新しいかを semver で判定する。
 * いずれかが有効な semver でない場合は例外を送出せず false を返す。
 */
export function isNewerVersion(latest: string, installed: string): boolean {
  if (typeof latest !== 'string' || typeof installed !== 'string') {
    return false
  }
  try {
    if (semver.valid(latest) === null || semver.valid(installed) === null) {
      return false
    }
    return semver.gt(latest, installed)
  } catch {
    return false
  }
}
