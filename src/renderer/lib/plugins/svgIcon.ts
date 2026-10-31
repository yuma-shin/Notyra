/**
 * Plugin が渡す SVG 文字列のアイコンを描画するためのスタイル（design.md 決定 #19）。
 * SVG を DOM に挿入せず CSS `mask-image` として使い、色は `currentColor` で塗る。
 * これにより SVG 内のスクリプトやイベント属性は実行されない。
 */
import type { CSSProperties } from 'react'

export function svgMaskStyle(svg: string): CSSProperties {
  const url = `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`
  return {
    maskImage: url,
    WebkitMaskImage: url,
    maskRepeat: 'no-repeat',
    WebkitMaskRepeat: 'no-repeat',
    maskPosition: 'center',
    WebkitMaskPosition: 'center',
    maskSize: 'contain',
    WebkitMaskSize: 'contain',
    backgroundColor: 'currentColor',
  }
}
