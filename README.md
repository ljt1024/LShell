# LShell

LShell 是一个类似 FinalShell 的 Web 版远程服务器管理 MVP。当前实现采用计划中的方案 A：

- 前端：React + TypeScript + Ant Design + xterm.js
- 后端：Node.js + Express + ssh2 + ws
- 实时通信：WebSocket

官网地址： http://118.31.167.0:7272/

## 当前功能

- SSH 密码认证与私钥认证
- 远程 shell 终端
- SFTP 目录浏览
- 文本文件读取与保存
- 小文件上传与下载
- 连接资料本地保存（不保存密码和私钥内容）
- 刷新页面后自动恢复同一浏览器标签页内的 SSH 连接
- WebSocket 心跳与空闲会话清理

## 启动

```bash
npm install
npm run dev:backend
npm run dev:frontend
```

默认地址：

- 前端：http://127.0.0.1:5173
- 后端：http://127.0.0.1:8080
- WebSocket：ws://127.0.0.1:8080/ws

## 构建

```bash
npm run build
```

## 环境变量

复制 `.env.example` 到 `.env` 后可调整：

```bash
PORT=8080
HOST=127.0.0.1
FRONTEND_ORIGIN=http://127.0.0.1:5173
VITE_WS_URL=ws://127.0.0.1:8080/ws
```

## 安全边界

这是本地/内网 MVP。生产部署前需要补齐：

- HTTPS/WSS
- 凭据加密存储或系统 Keychain
- 操作审计
- 用户与权限体系
- 上传/下载分片与大小限制策略

## 刷新恢复说明

前端只在 `sessionStorage` 中保存后端 SSH 会话 ID，不保存密码和私钥。刷新页面后会自动 attach 回后端已有 SSH session；如果后端服务重启或会话空闲超过 10 分钟，需要重新连接。终端窗口会重新打开，SSH 连接本身会保留。

## 目录

```text
backend/   Node.js API、SSH/SFTP、WebSocket
frontend/  React 工作台、终端、文件管理器
electron/  桌面端后续占位
```
