# プラグインレジストリの公開

アプリの取得先は `https://raw.githubusercontent.com/yuma-shin/notyra-plugins/main/registry.json`。
ToC・Amber・Blue・Emerald・Rose の5エントリを含む `main/registry.json` は公開済み。
[v1.0.0 Release](https://github.com/yuma-shin/notyra-plugins/releases/tag/v1.0.0) に
全5件の `<id>.zip` と、ToC用の互換名 `notyra-plugin.zip` を添付済み。
同じディレクトリの空の `registry.json` は初期サンプルで、実配布の正本は外部リポジトリの main。
公開手順と各リポジトリは [plugin-ecosystem.md](../plugin-ecosystem.md) を参照。
エントリの形式は次のとおり。

```json
{
  "schemaVersion": 1,
  "plugins": [
    {
      "id": "example-plugin",
      "name": "Example Plugin",
      "description": "プラグインの説明",
      "author": "作者名",
      "repo": "owner/example-plugin"
    }
  ]
}
```

`id` は配布パッケージの `package.json` の `name` と一致させる。
複数プラグインを1つのリポジトリで配布できる。レジストリ経由では最新 Release の
`<id>.zip` を優先し、なければ従来の `notyra-plugin.zip` を使う。ID 不一致なら中止する。
公式5件の `repo` はすべて `yuma-shin/notyra-plugins`。各 Release に全5件を添付する。
各エントリの5項目は必須の文字列。`repo` は `owner/repo` または GitHub の HTTPS URL。
レジストリの公開・外部リポジトリの変更は本体側のテストでは代替できない。
取得できない場合も設定画面の再試行とリポジトリ指定によるインストールは利用できる。

## 「対象プラグインの配布ZIPがありません」が出る場合

最新 Release の Assets に対象の `<id>.zip` があるかを確認する。2026-11-01 に、
Release 作成済みのため CI の `gh release create` が失敗し、Assets が0件になる問題を確認した。
v1.0.0 は成功済み CI のアーティファクトから6件を復旧し、全件の匿名ダウンロードと
SHA-256一致を検証済み。再発防止は [PR #2](https://github.com/yuma-shin/notyra-plugins/pull/2)。
