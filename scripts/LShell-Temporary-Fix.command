#!/bin/zsh

set -e

app_path="/Applications/LShell.app"
user_app_path="$HOME/Applications/LShell.app"

if [[ ! -d "$app_path" && -d "$user_app_path" ]]; then
  app_path="$user_app_path"
fi

if [[ ! -d "$app_path" ]]; then
  osascript -e 'display alert "未找到 LShell" message "请先打开 DMG，并将 LShell 拖入“应用程序”文件夹，然后再运行此临时修复工具。" as critical'
  exit 1
fi

xattr -dr com.apple.quarantine "$app_path"

if ! codesign --verify --deep --strict "$app_path"; then
  osascript -e 'display alert "LShell 校验失败" message "应用文件不完整，请重新下载安装包。" as critical'
  exit 1
fi

open "$app_path"
osascript -e 'display notification "隔离标记已清除，LShell 正在启动。" with title "LShell 临时安装"'
