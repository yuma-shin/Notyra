import type { Permission, PluginManifest } from '@/shared/plugin/types'

/** 同意済みの Permission と Declared_Destination の組 */
export interface ConsentRecord {
  permissions: Permission[]
  destinations: string[]
}

export interface ConsentDiff {
  /** 新しい宣言に含まれ、同意済みに含まれない Permission（宣言順） */
  addedPermissions: Permission[]
  /** 新しい宣言に含まれ、同意済みに含まれない Declared_Destination（宣言順） */
  addedDestinations: string[]
  /** 更新後に記録する同意済み集合（= 新しい宣言。宣言から外れたものは含まない） */
  nextConsent: ConsentRecord
}

function uniqueInOrder<T>(items: readonly T[]): T[] {
  return Array.from(new Set(items))
}

function declaredConsent(manifest: PluginManifest): ConsentRecord {
  if (manifest.type !== 'feature') {
    return { permissions: [], destinations: [] }
  }
  return {
    permissions: uniqueInOrder(manifest.permissions.map(p => p.name)),
    destinations: uniqueInOrder(manifest.networkDestinations ?? []),
  }
}

/**
 * 更新・開発者モード再読み込み時の同意差分を計算する。
 * 追加分 = 新しい宣言 − 同意済み。nextConsent は新しい宣言そのもの。
 * 入力は変更しない。
 */
export function diffConsent(
  consented: ConsentRecord,
  next: PluginManifest
): ConsentDiff {
  const nextConsent = declaredConsent(next)
  const consentedPermissions = new Set(consented.permissions)
  const consentedDestinations = new Set(consented.destinations)

  return {
    addedPermissions: nextConsent.permissions.filter(
      p => !consentedPermissions.has(p)
    ),
    addedDestinations: nextConsent.destinations.filter(
      d => !consentedDestinations.has(d)
    ),
    nextConsent,
  }
}
