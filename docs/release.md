# ブランチ運用とリリース

開発とリリースの起点は `main` に統一します。`develop` は使用しません。
変更用ブランチとリリース用ブランチを最新の `main` から作成し、Pull Request（PR）のマージ先も `main` にします。
release ブランチへの push による PR の自動作成・自動マージ・他ブランチへの書き戻しは行いません。

## 通常の変更

```bash
git switch main
git pull --ff-only origin main
git switch -c feature/example
```

変更をコミット・push し、`main` 向けの PR を手動で作成します。
CI は `main` 向けの非ドラフト PR の作成・更新・再オープン・レビュー可能への変更時に実行します。
CI の手動実行、PR のないブランチへの push、タグへの push、マージ時の CI はありません。

## リリース

1. 最新の `main` から、リポジトリ内に `release/v3.2.0` のようなブランチを作成します。
   ブランチ名は `release/vX.Y.Z`（3つの整数からなるバージョン形式）にします。プレリリース接尾辞は扱いません。
2. `package.json` と `src-tauri/tauri.conf.json` の `version` を、ブランチ名と同じ `3.2.0` に更新してコミットします。
3. ブランチを push し、`main` 向けの PR を手動で作成します。
4. CI の成功を確認して PR をマージします。
5. Release ワークフローが、PR のマージ後のコミットに `v3.2.0` タグと GitHub Release のドラフトを作成します。
   同じコミットから macOS（Universal）・Windows・Linux のパッケージを並行してビルドし、ドラフトに添付します。
   macOS ZIP、Windows ポータブル版と ZIP も添付します。
6. すべてのビルドの成功と添付ファイルを確認し、リリースノートを編集してドラフトを手動で公開します。
   公開後は、既存のワークフローが Web サイトの Vercel ビルドを起動します。

```bash
git switch main
git pull --ff-only origin main
git switch -c release/v3.2.0
# バージョンを更新してコミット
git push -u origin release/v3.2.0
# GitHub で main 向けの PR を作成し、CI の成功後にマージ
```

PR をマージせずに閉じた場合、通常の変更ブランチをマージした場合、タグだけを push した場合はリリース処理を行いません。
fork の release ブランチからの PR も対象外です。
バージョンの不一致や、別のコミットを指す同名タグがある場合は、リリース処理を停止します。

ビルドが失敗した場合は、GitHub Actions の同じ実行を再実行します。
同じマージコミットを指すタグと既存ドラフトを再利用し、成果物を再アップロードします。
一部のビルドが失敗したドラフトは、すべて成功するまで公開しないでください。
公開済みのリリースに対する再実行は停止します。修正のリリースには新しいバージョンを使います。

自動処理に使う権限は `GITHUB_TOKEN` の `contents: write` です。
旧 Release Flow で使っていた `RELEASE_PAT` と `DEPLOY_KEY` は、このリリース処理では不要です。

## develop からの移行

最初に、このワークフロー変更を `main` へ反映します。
GitHub の既定ブランチ、ブランチ保護・Rulesets、既存 PR のマージ先も `main` を基準に確認します。
リリースをマージする前に、この変更が `main` に入っている必要があります。
既存の release ブランチには古い Release Flow が残っているため、そのブランチへの push は引き続き自動 PR 作成・マージを起動し得ます。
移行後のリリースには、変更済みの最新 `main` から新しく作成したブランチを使います。

`develop` を削除する前に最新のリモートを取得し、残っている変更を確認します。

```bash
git fetch origin --prune
git log --oneline --left-right origin/main...origin/develop
git diff origin/main origin/develop
```

`develop` にだけある必要な変更は、変更用ブランチの PR で `main` に取り込みます。
移行後の作業ブランチは `main` から作成し、既存の作業ブランチも最新の `main` を取り込んでから PR を作成します。
既存 PR のマージ先と必要な変更の取り込みを確認した後で、GitHub 上の `develop` と不要になったローカルブランチを削除します。
自動マージにより履歴だけが分岐している場合があるため、コミット数とファイル差分の両方を確認してください。
