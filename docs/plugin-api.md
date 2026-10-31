# Plugin API パッケージの管理と公開

2026-11-01、`@notyra/plugin-api` を [yuma-shin/notyra-plugin-api](https://github.com/yuma-shin/notyra-plugin-api) に分離した。npm の公開先は `@notyra` organization。[PR #1](https://github.com/yuma-shin/notyra-plugin-api/pull/1) は未マージ、npm は未公開。

## 構成と更新

本体の `src/shared/plugin/api.ts`・`types.ts`・`manifest.ts` と `MarkdownNoteMeta` が契約の正本。独立 API リポジトリが生成ソース・宣言・検証器・npm メタデータ・テスト・公開 workflow を管理する。ToC・テンプレート・全サンプルから `vendor/plugin-api` とその型パス指定を削除した。

npm 公開前は、利用側の依存を API コミット `3f15cc1f4d516081b1b3c6815239d5d8f59e22ba` の tarball に固定する。公開後に同じ3.1.7の npm 版へ切り替えるまで、このコミットを含むブランチを維持する。

本体ルートから API の作業コピーへ生成する:

```sh
pnpm plugins:export-api .plugin-ecosystem/notyra-plugin-api
```

生成先は `src/` と `api-source.json` のみ。API リポジトリの設定・README・LICENSE を上書きしない。改行を LF に統一し、版・依存・ソースハッシュを記録する。API リポジトリで package.json の版・依存を揃え、ビルド・テスト後の `.d.ts`・`.js` もコミットする。CI が再ビルド後の差分を検査する。

実行時 API は Notyra が提供する。プラグインは `@notyra/plugin-api` をバンドルせずホストの仮想モジュールに変換する。型だけの import は `import type` を使う。Node 用の `@notyra/plugin-api/manifest` はパッケージの実装を使える。

## 検証

API の型・検証器の4テストに、Release 公開条件の3テストを追加し、計7件が成功。NodeNext の型利用側、npm 配布物12ファイルも検査した。公式5プラグイン、テンプレートと4サンプルは固定コミットの API だけで frozen install・型チェック・ビルド・起動テスト・ZIP生成を確認した。

[API の Release/OIDC workflow の検証 CI](https://github.com/yuma-shin/notyra-plugin-api/actions/runs/41219005701) は成功。公開ジョブは未実行。依存分離後の [公式プラグイン CI](https://github.com/yuma-shin/notyra-plugins/actions/runs/41217791454) と [テンプレート CI](https://github.com/yuma-shin/notyra-plugins-template/actions/runs/41217799089) も成功。

## npm 側の事前準備

ユーザー指定により、公開は **main へマージ → タグ → 正式な GitHub Release → OIDC で npm 公開**に統一する。ローカルからの公開は実施していない。npm のログインと @notyra の owner 権限は確認できたが、公開は EOTP で止まり、パッケージは未公開。

[npm の trust 前提条件](https://docs.npmjs.com/cli/v12/commands/npm-trust/#prerequisites)では、対象パッケージが既に npm に存在する必要がある。完全に未作成のパッケージの初回作成を、未設定の OIDC だけで行うことはできない。パッケージを作成する事前準備は別途必要で、完了するまで Release を公開しない。

事前準備後、[npm Trusted Publisher](https://docs.npmjs.com/trusted-publishers/) を設定する:

事前作成には [staged publishing](https://docs.npmjs.com/staged-publishing/) を使える。未作成のパッケージをステージすると、npm が公開プレースホルダー `0.0.0-stage` を自動作成する。ステージ操作自体は2FA不要（ログイン・権限・アカウントの2FA設定は必要）。

本体ルートから、準備済みの登録専用バージョンをステージする:

```sh
npm exec --yes --package=npm@12.2.1 -- npm stage publish ./.plugin-ecosystem/plugin-api-bootstrap --access public --tag bootstrap
```

`plugin-api-bootstrap` は登録専用の `0.0.0-bootstrap.0` で、README と package.json の2ファイルだけを含むことを確認済み。登録・公開コマンドは未実行。この準備版を Approve する必要はない。本物の3.1.7はステージしない。ステージ済みバージョンは同じ版の通常公開と競合するため。

npm にパッケージができたら、その Settings で以下を設定し、必要な2FAを完了する。

| 項目 | 値 |
| --- | --- |
| GitHub owner | `yuma-shin` |
| Repository | `notyra-plugin-api` |
| Workflow filename | `publish.yml` |
| Environment | 空欄 |
| Allowed actions | 直接の `npm publish` を許可 |

## GitHub Release から公開

1. API の PR を main にマージする。
2. main 上のコミットに package.json と一致する `v<version>` タグを作成する。
3. そのタグで正式な GitHub Release を公開する。
4. `publish.yml` が検証後に OIDC/provenance 付きで npm に公開する。

タグの push だけでは公開しない。draft・prerelease・バージョン不一致・main に含まれないコミットは公開できない。workflow は Node24・npm12.2.1 と `id-token: write` を使い、npm トークンの Secrets は不要。現在の3.1.7は、npm に同じ版が存在しないことを確認してから Release にする。公開済みの版は再公開できない。

## 利用側を npm 版へ切り替える

公開を確認してから、公式プラグインリポジトリで実行する:

```sh
pnpm add -Dw -E @notyra/plugin-api@3.1.7
pnpm --filter notyra-toc add -D -E @notyra/plugin-api@3.1.7
```

テンプレートリポジトリではルートと全サンプルを切り替える:

```sh
pnpm add -Dw -E @notyra/plugin-api@3.1.7
pnpm --filter "./examples/*" add -D -E @notyra/plugin-api@3.1.7
```

型チェック・ビルド・テスト・ZIP生成後、マニフェストとロックファイルを一緒にコミットする。未公開の npm 版へ先に切り替えるとインストールが404になる。
