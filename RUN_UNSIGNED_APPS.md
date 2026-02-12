# Running Unsigned Apps

[English version](./RUN_UNSIGNED_APPS.en.md)

FlowMarkはまだ未署名の状態です。  
FlowMarkアプリを実行する手順を説明します。

## macOS

macOS では、未署名アプリはデフォルトでブロックされます。以下の手順で実行できます。

1. アプリをダウンロードし、必要に応じて `Applications` フォルダへ移動する
2. アプリを開こうとすると、実行できない旨の警告が表示される
3. `システム設定` > `プライバシーとセキュリティ` を開く
4. ブロックされたアプリに対して `このまま開く`（Open Anyway）を選択する
5. 必要に応じてターミナルで次のいずれかを実行する

```sh
xattr -c '/Applications/FlowMark.app'
```

```sh
xattr -d com.apple.quarantine '/Applications/FlowMark.app'
```

```sh
codesign --force --deep --sign - '/Applications/FlowMark.app'
```

6. 再度アプリを起動する

## Linux

Linux では、実行権限が外れている場合があります。以下の手順で実行できます。

1. アプリをダウンロードし、任意のフォルダに配置する
2. ターミナルでアプリのあるフォルダに移動する
3. 実行権限を付与する

```sh
chmod +x FlowMark
```

4. ダブルクリックまたはターミナルから起動する

## Windows

Windows では、SmartScreen によってブロックされる場合があります。以下の手順で実行できます。

1. アプリ起動時に Windows Defender SmartScreen の警告が表示されたら `詳細情報` を選択する
2. `実行`（Run anyway）を選択する

これで未署名アプリを実行できます。
