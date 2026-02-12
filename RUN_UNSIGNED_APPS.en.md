# Running Unsigned Apps

[日本語版](./RUN_UNSIGNED_APPS.md)

FlowMark is currently distributed as an unsigned app.  
This document explains how to run the FlowMark app.

## macOS

On macOS, unsigned apps are blocked by default. Use the steps below:

1. Download the app and optionally move it to the `Applications` folder.
2. When you try to open it, a warning will appear saying the app cannot be opened.
3. Open `System Settings` > `Privacy & Security`.
4. For the blocked app, select `Open Anyway`.
5. If needed, run one of the following commands in Terminal:

```sh
xattr -c '/Applications/FlowMark.app'
```

```sh
xattr -d com.apple.quarantine '/Applications/FlowMark.app'
```

```sh
codesign --force --deep --sign - '/Applications/FlowMark.app'
```

6. Launch the app again.

## Linux

On Linux, executable permission may be disabled. Use the steps below:

1. Download the app and place it in your preferred folder.
2. Open Terminal and move to the app folder.
3. Grant execute permission:

```sh
chmod +x FlowMark
```

4. Start the app by double-clicking it or from Terminal.

## Windows

On Windows, SmartScreen may block the app. Use the steps below:

1. When a Windows Defender SmartScreen warning appears, click `More info`.
2. Click `Run anyway`.

You can now run the unsigned app.
