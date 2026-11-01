# 公式プラグインと開発環境

公式テーマは ToC と同じ `notyra-plugins` リポジトリへ統合し、API パッケージは `notyra-plugin-api` へ分離した。以下は実装先の PR 一覧。

2026-11-01 更新: 公式プラグインの main レジストリと [v1.0.0 Release](https://github.com/yuma-shin/notyra-plugins/releases/tag/v1.0.0) は公開済み。Release に ZIP が付いていなかった問題を CI アーティファクトから復旧し、全6アセットの匿名ダウンロードを確認した。再発防止は [PR #2](https://github.com/yuma-shin/notyra-plugins/pull/2)。詳細は [検証記録](plugin-system-validation.md) を参照。

| リポジトリ / PR | 内容 |
| --- | --- |
| [notyra-plugins #1](https://github.com/yuma-shin/notyra-plugins/pull/1) | ToC と Amber・Blue・Emerald・Rose の独立したプラグイン、公式レジストリ、全ZIPを同じ Release に添付する workflow |
| [notyra-plugins-template #1](https://github.com/yuma-shin/notyra-plugins-template/pull/1) | 文字数パネルのテンプレート、4サンプル、ビルド・ZIP生成・Release workflow |
| [notyra-plugin-api #1](https://github.com/yuma-shin/notyra-plugin-api/pull/1) | 独立した API 型・検証器、正本からの同期、ビルド・テスト、npm @notyra 向け公開 workflow |
| [Notyra-Website #14](https://github.com/yuma-shin/Notyra-Website/pull/14) | 日英のプラグイン開発ガイドと、既存テーマガイドの統合先への移行 |

旧 [Notyra-Theme PR #1](https://github.com/yuma-shin/Notyra-Theme/pull/1) は閉じた。テーマの実装・レジストリ・配布 workflow は統合先で管理する。Gray・Purple は本体内蔵のまま、カスタム4色のみをプラグイン化した。

ToC は ATX / Setext 見出しに対応し、コードブロック内の見出しを除外する。クリックで元の行に移動し、深さ・H1・行番号を設定できる。本体側の ActiveNoteBus の初期通知修正も必要。

テンプレートのサンプルはそれぞれ独立したプラグイン。`markdown-editor` は Markdown 変換と CodeMirror 拡張、`notes` はノート作成、`network` は同意した宛先への通信、`clipboard-links` はコピーと外部リンクを扱う。外部への操作はユーザーがボタンを押したときに実行する。

## ローカルの成果物

作業コピーは本体の `.plugin-ecosystem/` 内にある。このディレクトリは本体の Git 管理から除外している。既存の隣接リポジトリには書き込んでいない。

| 作業コピー | 配布物 |
| --- | --- |
| `.plugin-ecosystem/notyra-plugins/plugins/notyra-toc` | `dist/notyra-toc.zip`（ToC 1.0.0、`dist` は workspace 直下） |
| `.plugin-ecosystem/notyra-plugins/plugins/notyra-theme-{amber,blue,emerald,rose}` | `dist/notyra-theme-<色名>.zip`（各1.0.0、`dist` は workspace 直下） |
| `.plugin-ecosystem/notyra-plugins-template` | `notyra-plugin.zip`（テンプレート0.1.0）、各 `examples/*/notyra-plugin.zip` |
| `.plugin-ecosystem/notyra-plugin-api` | 独立した npm 用パッケージ。`.plugin-ecosystem/notyra-plugin-api-3.1.7.tgz` を pack 検証済み |
| `.plugin-ecosystem/Notyra-Website` | 開発ドキュメントのソースと `.next` の production ビルド |

ZIP を空フォルダに展開し、Notyra の「設定 → プラグイン → 開発者モード」でそのフォルダを選択すると、Release 公開前でも読み込める。ソースを使う場合は workspace のルートで `pnpm build` を実行し、`plugins/<ID>` を選ぶ。workspace 直下の `package.json` はプラグイン用ではない。旧 `.plugin-ecosystem/Notyra-Theme` は前回作業の控えで、配布元としては使わない。

## 検証

- ToC のテスト3件、全4テーマの検証、コレクションの配布テスト2件、テンプレートと4サンプルの起動テスト計5件が成功。全プロジェクトの型チェック・ビルド・ZIP生成も成功。
- 統合後の GitHub Actions は [公式プラグイン全5件](https://github.com/yuma-shin/notyra-plugins/actions/runs/41215829836) と [テンプレート・全サンプル](https://github.com/yuma-shin/notyra-plugins-template/actions/runs/41215835277) が成功。
- 全10 ZIP のルートマニフェスト・CRC・サイズを検査。本体 PluginHost での有効化・実操作・停止の結合テスト10件が成功。ネイティブ I/O とプロトコル転送はモック。
- 日英16ページの production build と HTTP 200・タイトル一致、既存テーマガイド4ページの HTTP 200・旧リポジトリURL除去を確認。公開予定 URL は `/docs/plugins`、`/en/docs/plugins` 以下。
- 本体は型チェック・Lint（警告0件）・フロントエンド1089件・Rust157件・clippy が成功。ID別アセットの優先、従来形式へのフォールバック、上限超過、不正ID、アセット欠落を検証。
- 本番の WebView2・CSP・GitHub からのダウンロード・ダイアログ・クリップボード・外部リンクは実機未確認。[制限と詳細](plugin-system-validation.md)を参照。

## 公開手順

1. 本体の対応と4件の PR をレビューしてマージする。統合配布には本体の複数アセット取得の変更も必要。
2. `notyra-plugins` のルート workspace の版と同じ `v1.0.0` タグを公開する。workflow が検証後、全5件の `<Plugin_ID>.zip` と ToC の別名 `notyra-plugin.zip` を1つの Release に添付する。
3. 全アセットを確認し、`notyra-plugins/main/registry.json` の5エントリから個別インストール・更新を確認する。レジストリは ID に一致する ZIP を優先し、なければ従来名へフォールバックする。リポジトリ名だけの直接指定は既定の ToC を取得する。各 Release には全プラグインを含める。
4. ドキュメントを既存サイトの公開フローで公開する。
5. `@notyra/plugin-api` は独立リポジトリから npm の @notyra organization に公開する。ToC・テンプレートから API の同梱コピーを削除し、公開前は独立リポジトリの固定コミットを参照する。公開後に npm の完全固定版へ切り替える。認証と Trusted Publisher を含む手順は [plugin-api.md](plugin-api.md) を参照。

API 更新時の生成例（本体のルートから実行）:

```sh
pnpm plugins:export-api .plugin-ecosystem/notyra-plugin-api
```

本体は API リポジトリのソースと同期メタデータだけを生成する。API リポジトリで版・依存を揃え、ビルド・テストと生成物をコミットする。npm 公開は main にマージ後の正式な GitHub Release を契機に独立 workflow が OIDC で行う。タグだけでは公開しない。npm 側のパッケージ事前作成と Trusted Publisher 設定は別途必要。
