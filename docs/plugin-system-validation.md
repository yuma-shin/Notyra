# plugin-system レビュー対応記録

2026-10-31〜2026-11-01、Windows で実施。

## ToC の行移動・表示切替ボタンの修正（2026-11-01）

編集のみでは移動できる一方、分割・プレビューのみでは見出しへ移動しない問題を本体側で修正した。

- 分割表示の CodeMirror はホイール操作を共通のスクロール領域へ渡すため `overflow-y: hidden` にしている。標準の `scrollIntoView` はその領域をスクロールせず、さらにプレビューを起点とした同期がプログラムによる移動を戻していた。明示的な移動を同期の起点とし、CodeMirror の計測フェーズで位置を取得して移動する。画面外の行の高さが描画後に変わる場合はもう一度補正する。
- プレビューのみでは CodeMirror が破棄される。プレビュー用の移動先を登録し、Markdown の `data-source-line` で対応する描画ブロックへ移動する。モード変更・アンマウントで登録を解除する。
- 表示切替ボタンの配置を画面基準の `fixed` からエディタ内の `absolute` に変更。ToC 側へはみ出さず、ボタンまでポインターを移動してもエディタのホバーが続く。フォーカス中も表示し、現在のモードを `aria-pressed` で示す。

Edge の実ブラウザーで、本体の EditorView・SidePanel・PluginHost と公開済み `notyra-toc` 1.0.0 の配布 JS を組み合わせ、1,543行・70見出しの文書を操作した。ネイティブ I/O と配布プロトコルは検証用に置き換え、スクロール・Markdown 描画・CSS・ToC のクリック処理は実装をそのまま使った。

- 修正前は分割・プレビューのスクロール位置が0のままで、選択した40番目の見出しは表示領域から約20,133px下に残った。修正後は全3モードで40番目・5番目の見出しへ往復し、移動後も位置が戻らないことを確認。
- 実際のフローティングボタンをクリックして全モードへ切替。ToC の開閉後もボタンがエディタの境界内に収まり、操作できることを確認。
- 分割表示でエディタ上のホイール操作が共通領域を350pxスクロールし、Ctrl+End で最終行へ移動することを確認。
- ブラウザーの例外・console.error は0件。長文の仮想化処理では CodeMirror の `Measure loop restarted more than 5 times` 警告が2件出たが、移動先・同期・操作の検証は成功した。WebView2 のネイティブアプリ操作は今回も未確認。

回帰テストにはプレビューの行対応・登録解除・分割表示の同期起点・CodeMirror の読み書きフェーズ分離・仮想化による高さ補正を追加。`pnpm typecheck`、`pnpm lint`（警告0件）、`pnpm test --reporter=dot`（139ファイル・1,095件）、`pnpm build:vite` が成功。ビルドには従来の大きなチャンクと静的・動的 import の重複に関する警告が残る。ブラウザー検証用スクリプト・結果・画像は `.plugin-ecosystem/scroll-repro/` に保存。本体側の変更なので、適用には開発アプリの再起動または本体の再ビルドが必要。ToC の再インストールは不要。

## 配布ZIPの復旧（2026-11-01）

ユーザーのインストール時に NoPackage が発生。`notyra-plugins` の最新 Release `v1.0.0` は公開されていたが、Assets が0件だった。CI run `41220477151` は validate・ZIP生成・アーティファクト保存が成功し、release ジョブだけが `a release with the same tag name already exists` で失敗していた。

- タグ `v1.0.0` のコミット `e52e4da4beecbf4b70446256d2d0d698f5989767` は維持。
- 成功済み CI artifact `13049269203` を取得し、GitHub 記録の SHA-256 `d8481d06a5279671db49254827c174dfba4cb3fbd11a32bc264549e6bbd76aa0` と照合。
- 全5プラグインの ZIP と ToC 互換名 ZIP の計6件について、CRC・ルートの package.json・ID・版・テーマ定義を検査し、既存 Release に添付。
- 本体と同じ匿名アクセスで全6件を公開URLから取得し、CI の配布物との SHA-256 一致を確認。
- 実際の CI 配布 ZIP を本体 PluginHost に読み込む結合検証を含む10件が成功。ネイティブ I/O とプロトコル転送はモックで、GUI操作によるインストールは未確認。

再発防止の [notyra-plugins PR #2](https://github.com/yuma-shin/notyra-plugins/pull/2) では、既存 Release は ZIP の upload、新規の場合は create に分岐させる。Release公開イベントにも対応し、同じタグのジョブを直列化。実際の workflow スクリプトを実行する3件の回帰テストが成功。今回の復旧では本体コードは変更していない。

復旧記録は `.plugin-ecosystem/release-repair/`。以下はこれまでの実装・検証履歴。

## 修正

- `rust-toolchain.toml` で Rust 1.95.0、clippy、rustfmt を固定。Cargo の最低対応バージョンと PR・リリース CI も揃えた。
- `0.0.0.0`・`::`・IPv4 射影 IPv6 の未指定アドレスを Private に分類。公開ホストの名前解決結果に含まれる場合、送信前にブロックする。要件・設計・境界値テストも更新。IP を宛先として明示的に同意したローカル通信は従来の規則に従う。
- 通常 UI の `rename_note` も、書き込み前に正規化したパスで同一ファイルを判定。Windows の区切り文字・大文字小文字の違いによる自己削除を防いだ。
- Property 41 で見つかった Front Matter の文字列・配列・キーのエスケープ不備を、通常保存とプラグイン保存の共有処理で修正。プラグインからの読み取りでは本文末尾の空行も保持する。
- clippy の指摘と `dropdown-menu.tsx` の `useMathMinMax` 警告を修正。
- `plugin_read_staging_text` はインストール前のテーマ検証に必要なため維持。staging 外へのアクセスを拒否する既存テストも検証対象に含めた。

## 自動テスト

Property 1〜41 に `Feature: plugin-system, Property N` のタグを付け、fast-check / proptest で各100回以上実行する。既存のユニットテストも再実行した。

| Property | 実装先 |
| --- | --- |
| 1〜4、37、38 | `.test/shared/plugin/manifest.property.test.ts` |
| 5、8〜10、26、27、36 | `.test/renderer/lib/plugins/logic.property.test.ts` |
| 6、13、27、28 | `.test/renderer/lib/plugins/pluginManager.test.ts` |
| 7 | `.test/renderer/components/settings/plugins/RegistryList.test.tsx` |
| 11 | `.test/renderer/components/settings/plugins/ConsentDialog.test.tsx` |
| 12 | `.test/renderer/components/settings/plugins/PluginsSection.text.property.test.tsx` |
| 14、15、31 | `.test/renderer/lib/plugins/host/pluginApi.test.ts` |
| 16〜19、23〜25、39〜41 | `src-tauri/src/plugins/property_tests.rs` |
| 20〜22 | `.test/renderer/lib/plugins/host/pluginHost.test.ts` |
| 29、30、35 | `.test/renderer/lib/plugins/registries.property.test.ts` |
| 32〜34 | `.test/renderer/lib/markdownPipeline.property.test.ts` |

追加した主な結合・境界検証:

- `.test/fixtures/plugins/` の TS ビルド版と手書き ESM 版を、PluginHost のローダー経由で実際に ESM として評価し、有効化・登録解除を検証。プロトコルの転送部分だけを偽のローダーで置き換える。
- `pnpm test` はフィクスチャを毎回ビルドする。単独ビルドは `pnpm test:plugin-fixtures`。
- ローカル HTTP サーバーで生成した最大10段のリダイレクトを処理し、未同意の宛先より先に通信しないことを要求回数でも確認。
- 実ファイルを使った状態の保存・復元、ノートの作成・移動・読み書き、更新失敗時の復元、停止完了前にアンインストールしないこと、開発フォルダのハッシュが変わらないことを確認。
- IPC 引数・構造化エラー・購読解除、タイムアウト、Toast、SidePanel、設定画面、テーマ、Markdown 再生成と PDF エクスポートを検証。

最終コマンド: `pnpm typecheck`、`pnpm lint`、`pnpm test --reporter=dot`、`cargo test`、`cargo clippy --all-targets -- -D warnings`（Cargo は `src-tauri/`）。

結果: 型チェック・Lint・clippy は成功。フロントエンド 138 ファイル / 1086 件、Rust 156 件がすべて成功。Lint 警告は0件。

フロントエンドの production ビルドも成功。Vite の大きなチャンクと静的・動的 import の重複に関する警告は残る。

## レジストリの公開

取得先は `yuma-shin/notyra-plugins` の `main/registry.json`。10月31日の初回確認ではリポジトリが空だった。その後、ToC と4テーマを掲載するレジストリを [notyra-plugins PR #1](https://github.com/yuma-shin/notyra-plugins/pull/1) に追加した。PR は未マージで、`main/registry.json` とプラグインの GitHub Release はまだ公開していない。通常のインストールには、マージと配布 ZIP の Release 公開が必要になる。

## 公式プラグイン・開発環境の追加

初回の対応では別リポジトリの成果物を未実装のまま残していた。その後、外部リポジトリに実装した。テーマは ToC と同じ `notyra-plugins` へ統合し、API は独立した `notyra-plugin-api` へ分離した。旧テーマ専用 PR は閉じた。現在の4件のドラフト PR と配布物の場所は [plugin-ecosystem.md](plugin-ecosystem.md) を参照。

- Amber・Blue・Emerald・Rose のテーマ（ライト・ダーク、選択時だけ有効な CSS）、ToC（現在ノート・見出しクリックで行移動・設定）を同じ workspace に追加。
- TypeScript テンプレート、Markdown/CodeMirror・ノート・通信・クリップボード/外部リンクの4サンプルを追加。
- 正本から生成する `@notyra/plugin-api` 3.1.7 を独立した `notyra-plugin-api` リポジトリに配置。利用側から同梱コピーを削除し、初回 npm 公開前は独立リポジトリの固定コミットを参照する。生成コマンドは `pnpm plugins:export-api <APIリポジトリのディレクトリ>`。
- 開発ガイドを日英8ページずつ追加。独立したロックファイルの依存環境で production build が成功し、全16 URL の HTTP 200 と各言語のタイトルを確認。
- 10個の実配布 ZIP を展開し、本体 PluginHost に読み込む結合テスト10件が成功。ネイティブ I/O とプロトコル転送をモック化し、初期ノート表示・操作・設定変更・停止を検証した。
- 本体の ActiveNoteBus に現在ノートの初期通知を追加。既に開いているノートを、後から起動した ToC でも表示できる。初期通知・複製・例外分離・解除のテストを追加した。

統合に合わせて、本体は ID ごとの `<ID>.zip` を取得・更新する方式を追加。従来の `notyra-plugin.zip` にも対応し、取得したマニフェストの ID を照合する。追加後の型チェック・Lint（警告0件）、フロントエンド139ファイル / 1089件、Rust157件、clippy が成功。外部リポジトリでは型チェック・ビルド・起動テスト・ZIP生成を確認。npm は pack まで確認し、公開は未実施。

Website はローカルの独立した依存環境で検証し、既存テーマガイド4ページも HTTP 200 と旧配布先 URL の除去を確認。この PR に対する GitHub Actions の実行はない。

統合後の [公式プラグイン CI](https://github.com/yuma-shin/notyra-plugins/actions/runs/41215829836) と [テンプレート CI](https://github.com/yuma-shin/notyra-plugins-template/actions/runs/41215835277) も成功。

API 分離後の CI と型・検証器の4テストが成功。ユーザー指定で公開を GitHub Release と OIDC に揃え、main へのマージ・バージョン一致・正式な Release 公開の条件を検証する3テストも追加し、計7件が成功。npm tarball の12ファイルと、独立APIを使う配布ZIPの結合テスト10件を確認した。npm のログインと公開権限は確認できたが、公開は EOTP で止まり、未公開。OIDC は npm 側のパッケージ事前作成と Trusted Publisher 設定が必要。[管理と公開手順](plugin-api.md)を参照。

## 実機確認の制限

Windows の Computer Use ヘルパーが `native pipe is unavailable` / OS error 2 で接続できず、再試行・ランタイム再初期化後も復旧しなかった。そのためアプリを操作しての実機確認は未実施。

特に WebView2 上の独自プロトコルと CSP、GitHub からの実配布物取得、ネイティブのフォルダ選択ダイアログ、実クリップボード、外部リンクを開く処理は、自動テストやコンパイル成功だけでは確認済みとしない。操作環境が復旧した後、配布フィクスチャの読み込み・再読み込み・停止と合わせて確認する。

`.kiro/specs/plugin-system/tasks.md` の完了チェックは自動テストの実装・検証を示す。実機確認や外部リポジトリへの公開完了は意味しない。
