/**
 * アクティブなノートの切り替えと本文の変更を、このウィンドウの ActiveNoteBus に
 * Active_Note_Event として発行する（Requirement 13.11、13.14）。
 * メインウィンドウは `useNoteWorkspace`、ノートウィンドウは `screens/editor.tsx` から呼ぶ。
 *
 * PluginHostProvider の外（設定画面・既存テスト）では何もしない。
 */
import { useEffect, useRef } from 'react'
import { usePluginRegistries } from '../contexts/PluginHostContext'
import { ActiveNotePublisher } from '../lib/plugins/host/activeNotePublisher'
import type { ActiveNoteEvent } from '@/shared/plugin/api'

export interface UseActiveNoteEventsParams {
  windowKind: ActiveNoteEvent['windowKind']
  /** アクティブなノートのパス。未選択なら null */
  path: string | null
  title: string
  rootFolder: string
  /** 現在の本文 */
  body: string
  /** `body` がどのノートの本文か（本文の読み込み前は選択中のノートと一致しない） */
  bodyPath: string | null
}

export function useActiveNoteEvents({
  windowKind,
  path,
  title,
  rootFolder,
  body,
  bodyPath,
}: UseActiveNoteEventsParams): void {
  const bus = usePluginRegistries()?.activeNote ?? null
  const publisherRef = useRef<ActiveNotePublisher | null>(null)

  // ActiveNoteBus ごとに発行器を作り、破棄時は保留中の `changed` を発行してから止める
  useEffect(() => {
    if (!bus) return
    const publisher = new ActiveNotePublisher({
      windowKind,
      publish: event => bus.publish(event),
    })
    publisherRef.current = publisher
    return () => {
      if (publisherRef.current === publisher) publisherRef.current = null
      publisher.dispose()
    }
  }, [bus, windowKind])

  // 発行器の生成 effect の後に実行されるため、初回の状態も反映される
  useEffect(() => {
    publisherRef.current?.update({
      note: path === null ? null : { path, title, rootFolder },
      body,
      bodyPath,
    })
  }, [bus, windowKind, path, title, rootFolder, body, bodyPath])
}
