# LShell

LShell 是一个面向远程 Linux 服务器管理的桌面工作台。它保留完整的 SSH shell 使用体验，并在终端中集成自然语言命令助手，同时提供文件管理、服务器状态、防火墙、Nginx 和访问来源可视化能力。

## 界面预览

官网介绍使用的产品截图也随项目提供，展示服务器概览、远程目录、文件浏览器和终端协同工作的完整场景。

<table>
  <tr>
    <td width="50%"><img width="100%" src="assets/image1.png" alt="LShell 服务器概览，展示 CPU、内存、防火墙、Nginx 和磁盘状态" /></td>
    <td width="50%"><img width="100%" src="assets/image2.png" alt="LShell 服务器目录工作区，展示远程目录树、文件浏览器和终端" /></td>
  </tr>
  <tr>
    <td align="center">服务器概览与服务状态</td>
    <td align="center">远程文件、目录树与终端</td>
  </tr>
</table>

## 技术栈

- 前端：React + TypeScript + Ant Design + xterm.js + Leaflet
- 后端：Node.js + Express + ssh2 + ws
- 桌面端：Electron
- 实时通信：WebSocket

## 当前功能

- SSH 密码认证与私钥认证
- 远程 shell 终端与 PTY 状态保持
- SFTP 远程目录树、文件浏览、文本编辑、上传和下载
- 中文终端意图识别：输入包含中文时进入命令助手模式，普通 shell 命令保持原样执行
- 命令助手直接在当前终端中回复
- 根据用户意图推荐命令；低风险命令可直接在当前 PTY 中执行，高风险操作需要确认
- `cd` 等状态命令在当前 shell 会话中执行，确保工作目录能被后续命令和文件浏览器正确继承
- WebSocket/SSH 断线检测、自动重连、刷新页面恢复和手动重新连接
- 服务器概览：CPU、内存等运行状态
- 防火墙状态与规则管理
- 阿里云 ECS 安全组只读同步：通过实例 RAM 角色读取安全组和入/出方向规则，不保存长期 AccessKey
- Nginx 状态和可视化配置
- Nginx 访问 IP 来源统计与地图标记
- 连接资料本地保存，不保存密码和私钥内容
- WebSocket 心跳与空闲会话清理
- Electron 桌面端内置本地后端，并支持系统文件选择器选择 SSH 私钥

## 界面布局

应用左侧是主功能导航，右侧根据当前菜单展示内容：

```text
左侧主菜单         右侧内容区域
┌──────────┐      ┌──────────┬──────────────────┐
│ 服务器概览 │      │ 远程目录树 │ 文件浏览器        │
│ 服务器目录 │      │          ├──────────────────┤
│ 防火墙    │      │          │ 终端             │
│ Nginx    │      └──────────┴──────────────────┘
│ 连接管理  │
└──────────┘
```

终端仅在“服务器目录”页面展示。远程目录树位于右侧内容区域的左栏，文件浏览器和终端位于其右侧上下区域。

## Web 开发模式

首次运行先安装依赖：

```bash
npm install
```

分别启动后端和前端：

```bash
npm run dev:backend
npm run dev:frontend
```

默认地址：

- 前端：`http://127.0.0.1:5173`
- 后端：`http://127.0.0.1:8080`
- WebSocket：`ws://127.0.0.1:8080/ws`

## Electron 桌面端

桌面端会先构建前后端，再由 Electron 主进程启动本地后端并打开应用窗口：

```bash
npm run dev:desktop
```

也可以使用：

```bash
npm run desktop
```

桌面端默认读取 `.env` 中的 `HOST` 和 `PORT`，并通过本地后端托管 `frontend/dist`。如果配置端口已被开发后端占用，桌面端会自动选择下一个可用端口。窗口尺寸和位置会保存在 Electron 用户数据目录中。

当前项目使用 Electron 37。Electron 二进制默认从官方 GitHub Releases 下载。发布构建如果未配置 Apple Developer ID，会使用 Ad-hoc 签名；这种安装包首次运行可能被 macOS Gatekeeper 提示“Apple 无法验证 LShell 是否包含可能危害 Mac 安全或泄漏隐私的恶意软件”。这表示应用未完成 Apple 公证，不代表已检测到恶意软件。

macOS 首次打开未公证安装包：

1. 将 `LShell.app` 拖到“应用程序”目录。
2. 在 Finder 中右键点击 LShell，选择“打开”，然后在确认对话框中再次点击“打开”。
3. 如果仍被阻止，可在终端移除下载隔离标记后启动：

```bash
xattr -dr com.apple.quarantine /Applications/LShell.app
open /Applications/LShell.app
```

要让用户直接双击且不出现此提示，需要使用 Apple Developer ID 对 App/DMG 签名并完成 Apple 公证；这需要有效的 Apple 开发者账号、签名证书和公证凭据。

## 构建与检查

```bash
npm run build
npm run typecheck
```

## 环境变量

复制 `.env.example` 为 `.env` 后按需调整：

```bash
PORT=8080
HOST=127.0.0.1
FRONTEND_ORIGIN=http://127.0.0.1:5173
VITE_WS_URL=ws://127.0.0.1:8080/ws
QWEN_API_KEY=your_dashscope_api_key
QWEN_MODEL=qwen-plus
QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_TIMEOUT_MS=30000
QWEN_STREAM=true
```

## 终端助手行为

- 不含中文的输入按普通 shell 命令发送到当前远程 PTY
- 包含中文的输入会被识别为自然语言意图，由模型生成相关命令和说明
- 低风险命令可直接执行；涉及删除、覆盖、权限、服务中断等操作时要求用户确认
- `cd`、环境变量和其他依赖 shell 状态的命令必须在当前 PTY 中执行，不能通过一次性子进程模拟
- 模型生成的命令在执行前由后端再次进行风险校验
- 危险命令会被阻断，包括根目录递归删除、磁盘格式化、关机重启、fork bomb 和覆盖系统认证文件等
- 单条受控命令默认有超时与输出大小限制，stdout/stderr 通过 WebSocket 实时推送

## 连接恢复

前端不保存 SSH 密码和私钥内容。连接中断时界面会显示提示并提供重新连接操作；临时网络异常会触发自动重连。刷新页面后，前端会优先恢复已有会话，恢复失败时引导用户重新建立 SSH 连接。

## 阿里云安全组同步

防火墙页面的“阿里云安全组”标签通过远程 ECS 实例元数据识别实例 ID、地域和绑定的 RAM 角色，再使用临时凭证只读查询安全组规则。临时凭证只用于当前同步请求，不写入磁盘或浏览器。

使用前需要：

- 目标服务器是阿里云 ECS，并可访问实例元数据地址 `100.100.100.200`
- ECS 已绑定 RAM 实例角色
- 角色包含 `ecs:DescribeSecurityGroupAttribute` 只读权限

该功能不会把云端安全组规则自动写入 UFW/firewalld，也不会修改阿里云安全组。

## 安全边界

当前版本适合本地或受信任内网环境。生产部署前仍需补齐：

- HTTPS/WSS
- 凭据加密存储或系统 Keychain
- 用户、角色与权限体系
- 操作审计和高风险命令审批
- 上传下载分片、断点续传与大小限制
- 防火墙和 Nginx 配置变更的备份、校验与回滚
- IP 地理位置服务的隐私策略和调用限额

## 目录结构

```text
backend/   Node.js API、SSH/SFTP、WebSocket 和服务器管理能力
frontend/  React 控制台、终端、文件管理器与可视化页面
electron/  Electron 主进程、启动脚本与预加载桥
```
