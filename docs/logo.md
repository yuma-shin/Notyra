# Notyra ロゴ

「Glass Scribe」をコンセプトに、開いたガラスのノートと万年筆のペン先をひとつの左右対称の形に融合しています。左右のページの下端をつなぎ、丸みのあるペン先にまとめました。ページ間の縦の隙間は下に向かって細くなり、丸いインク穴と先端へ伸びる切り込みにつながります。青と紫の色を強め、白い反射の強さを抑えて、明るさを保ちながらコントラストを高めています。

アプリ内と配布アイコンはどちらも背景なしで、ノートとペン先のマークだけを表示します。マークの外側は透明です。キャンバスは正方形で、中心を保った `128 128 768 768` の viewBox により、デスクトップでも十分な大きさで見えるよう余白を調整しています。

ノートとペン先には共通の青紫のグラデーションを使い、細い白い輪郭を重ねています。全体がひとつのパスでつながっているため、ペン先だけが浮いたり、接合部分に輪郭が重なったりしません。中央の隙間、インク穴、切り込みは透明な抜きとして描き、アプリ内では背後の色が見えます。

[Inkdrop のアイコン](https://www.inkdrop.app/images/inkdrop.svg)の丸みのある立体表現を参考に、上部のふちには幅の広い柔らかな反射を加えています。ページの面には左右対称の曲面の陰影を重ね、内側のふちへ回り込む影で、厚みのあるガラスとして見えるようにしています。

輪郭の左右の座標を x=512 の中心線に対して対称にし、反射の装飾は左側を反転して右側に重ねています。マークの輪郭は x=224〜800、y=192〜832 で、表示枠と同じ (512, 512) を中心にします。アプリ内の SVG は中心を保った正方形の viewBox を使い、回転や片側だけの座標調整は加えません。

当初の参考は [Inkdrop](https://www.inkdrop.app/) の幾何学的な構成、[Obsidian](https://obsidian.md/brand) の面の重なり、[Boost Note](https://medium.com/boostnote/boostnote-boost-your-happiness-productivity-and-creativity-4fd2ce4cc510) の紙を抽象化する発想です。現在は左右対称、ガラスの質感、ノートとペン先が融合した輪郭を組み合わせています。

## 編集と再生成

元データは以下の SVG です。

- `src/resources/build/icons/light/notyra-logo.svg`
- `src/resources/build/icons/dark/icon.svg`

SVG を変更したら、プロジェクトルートで `pnpm icons` を実行してください。インストール済みの Tauri CLI を使って両テーマの PNG（16〜1024px）、ICO、ICNS を生成し、公開用アイコンと README の画像も更新します。各テーマの `mark.svg`／`mark.png` は、アプリ内表示用の背景なしのマークです。配布アイコンには背景が透明な `dark/icon.png` を使います。`dark` は既存の配布設定に合わせたディレクトリ名です。

類似するアイコンの確認結果は [調査メモ](icon-similarity-review.md) を参照してください。

## Apple の Liquid Glass 用レイヤー

再生成時に `src/resources/build/icons/layers/` に以下を出力します。

- `background.svg`: レイヤー編集用の任意の円形背景（配布アイコンには含めません）。
- `foreground.svg`: ハイライトや影を焼き込んでいないノートとペン先。

[Apple のアプリアイコンのガイドライン](https://developer.apple.com/design/human-interface-guidelines/app-icons/)に沿って、背景と前景を分けています。macOS で動的な Liquid Glass アイコンを実装する場合は、これらを [Icon Composer](https://developer.apple.com/documentation/xcode/creating-your-app-icon-using-icon-composer) に読み込み、ガラス効果と各外観を設定してください。

現在の Tauri バンドルは ICNS を参照しています。SVG／PNG／ICO／ICNS は静的なデザインであり、OS による動的な反射・屈折・外観切り替えの組み込みは含みません。
