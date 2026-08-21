import {
  ArrowRightOutlined,
  CheckOutlined,
  CloudServerOutlined,
  CodeOutlined,
  DownloadOutlined,
  FolderOpenOutlined,
  GlobalOutlined,
  MenuOutlined,
  SafetyCertificateOutlined,
  ThunderboltOutlined,
  WindowsOutlined,
  AppleOutlined
} from "@ant-design/icons";
import { useState } from "react";
import workspaceImage from "../../../assets/image1.png";
import agentImage from "../../../assets/image2.png";
import "./website.css";

const features = [
  { icon: <CodeOutlined />, tone: "coral", title: "中文意图，直接变成命令", text: "不用记住每一个参数。描述你想完成的事情，LShell 会结合当前目录与会话生成可执行方案。" },
  { icon: <FolderOpenOutlined />, tone: "blue", title: "文件、终端始终在一起", text: "浏览远程目录、查看文件并执行命令，不再反复切换窗口，也不会丢失当前工作上下文。" },
  { icon: <SafetyCertificateOutlined />, tone: "gold", title: "风险动作，先说明再执行", text: "命令经过风险分级。低风险操作顺畅完成，敏感动作明确展示影响并等待你的确认。" }
];

const abilities = [
  ["服务器概览", "CPU、内存、磁盘与系统状态集中呈现，连接后先看清全局。"],
  ["远程文件管理", "目录树、文件预览、上传下载与终端保持在同一个工作区。"],
  ["防火墙检查", "分别查看主机防火墙与云安全组，快速定位规则冲突。"],
  ["Nginx 与访问来源", "检查服务状态、配置和访问地理分布，更快发现异常。"]
];

export default function Website() {
  const [menuOpen, setMenuOpen] = useState(false);
  const macDownload = "/downloads/LShell-0.1.5-arm64.dmg";
  const windowsDownload = "/downloads/LShell-Setup-0.1.2.exe";

  return <main className="moe-site">
    <section className="moe-hero" id="top">
      <header className="moe-nav">
        <a className="moe-brand" href="#top" aria-label="LShell 首页"><span><CodeOutlined /></span><strong>LShell</strong></a>
        <button className="moe-menu" onClick={() => setMenuOpen((value) => !value)} aria-label="切换导航"><MenuOutlined /></button>
        <nav className={menuOpen ? "is-open" : ""}>
          <a href="#features" onClick={() => setMenuOpen(false)}>功能</a>
          <a href="#workspace" onClick={() => setMenuOpen(false)}>工作区</a>
          <a href="#security" onClick={() => setMenuOpen(false)}>安全</a>
          <a href="#questions" onClick={() => setMenuOpen(false)}>答疑</a>
        </nav>
        <a className="nav-launch" href="#download">客户端下载 <DownloadOutlined /></a>
      </header>

      <div className="hero-center">
        <div className="hero-orbit orbit-left" aria-hidden="true"><span>SSH</span><i /><i /></div>
        <div className="hero-title-mark"><CodeOutlined /></div>
        <p className="hero-eyebrow">REMOTE SERVER WORKSPACE</p>
        <h1>让 Shell<br />更懂你的意图</h1>
        <p className="hero-subtitle"><span>连接远方</span><i />保留现场</p>
        <p className="hero-description">一个集成终端、文件、服务状态与安全规则的远程服务器工作台。<br />照常输入命令，也可以直接用中文说出你要完成的事。</p>
        <div className="hero-actions">
          {/* <a className="button-dark" href={macDownload}><AppleOutlined /> 下载 macOS 版</a> */}
          <a className="button-red" href="#features"><span>↓</span> 查看功能</a>
        </div>
        <div className="hero-orbit orbit-right" aria-hidden="true"><i /><i /><span>PTY</span></div>
      </div>
      <div className="hero-stamps" aria-hidden="true">
        <span className="stamp stamp-one">SSH<br /><b>READY</b></span>
        <span className="stamp stamp-two"><CloudServerOutlined /><b>REMOTE</b></span>
        <span className="stamp stamp-three">01<br /><b>SESSION</b></span>
        <span className="stamp stamp-four"><SafetyCertificateOutlined /><b>SAFE</b></span>
        <span className="stamp stamp-five">CN<br /><b>INTENT</b></span>
      </div>
    </section>

    <section className="intro-section" id="features">
      <header className="feature-heading">
        <div className="round-icon coral"><ThunderboltOutlined /></div>
        <div><p>少一些工具切换，多保留一点现场</p><h2>一套完整的远程运维体验</h2></div>
      </header>
      <div className="main-shot-wrap">
        <div className="main-shot"><div className="window-bar"><i /><i /><i /><span>LShell · Remote Workspace</span></div><img src={workspaceImage} alt="LShell 远程服务器工作区界面" /></div>
        <span className="shot-note note-left">FILES<br /><b>同屏浏览</b></span>
        <span className="shot-note note-right">SHELL<br /><b>状态连续</b></span>
      </div>
    </section>

    <section className="feature-section">
      <header className="showcase-title"><div className="round-icon blue"><CodeOutlined /></div><h2><span>熟悉的终端，</span><span>多一层恰到好处的智能。</span></h2></header>
      <div className="feature-cards">{features.map((feature) => <article key={feature.title}>
        <div className={`feature-medallion ${feature.tone}`}>{feature.icon}</div><h3>{feature.title}</h3><p>{feature.text}</p>
      </article>)}</div>
      <div className="agent-showcase">
        <div className="agent-copy"><span>AI SHELL / 01</span><h3>它不是另一个聊天框，<br />而是当前终端的理解层。</h3><p>LShell 读取当前会话上下文，将自然语言目标转成清晰的命令计划。执行仍然发生在真实 PTY 中，目录、环境变量和输出都保持连续。</p><ul><li><CheckOutlined /> 中文意图识别</li><li><CheckOutlined /> 命令风险分级</li><li><CheckOutlined /> 当前会话持续执行</li></ul></div>
        <div className="agent-image"><img src={agentImage} alt="LShell 智能命令计划界面" /><div className="intent-bubble"><span>$</span> 帮我检查 nginx 错误日志</div></div>
      </div>
    </section>

    <section className="workspace-section" id="workspace">
      <header className="showcase-title"><div className="round-icon gold"><FolderOpenOutlined /></div><h2><span>从连接到排查，</span><span>每一步都在同一个工作区。</span></h2></header>
      <div className="ability-layout">
        <div className="ability-list">{abilities.map(([title, text], index) => <article key={title}><span>{String(index + 1).padStart(2, "0")}</span><div><h3>{title}</h3><p>{text}</p></div></article>)}</div>
        <div className="connection-card"><span className="tiny-label">DESKTOP WORKSPACE</span><div className="connection-visual"><GlobalOutlined /><i /><CloudServerOutlined /></div><h3>安装客户端，连接服务器，<br />完整工作区立即就绪。</h3><p>支持密码与私钥认证，网络恢复后自动重连并回到现场。</p><a href="#download">下载客户端 <ArrowRightOutlined /></a></div>
      </div>
    </section>

    <section className="security-section-new" id="security">
      <header className="showcase-title"><div className="round-icon coral"><SafetyCertificateOutlined /></div><h2><span>看见每一层规则，</span><span>再放心做出改变。</span></h2></header>
      <div className="security-diagram">
        <article><small>CLOUD EDGE</small><CloudServerOutlined /><h3>云安全组</h3><p>只读同步阿里云规则</p></article><i className="diagram-link" />
        <article><small>HOST LEVEL</small><SafetyCertificateOutlined /><h3>主机防火墙</h3><p>UFW 与 firewalld</p></article><i className="diagram-link" />
        <article><small>SERVICE</small><GlobalOutlined /><h3>Nginx / SSH</h3><p>服务状态与访问来源</p></article>
      </div>
    </section>

    <section className="faq-section" id="questions">
      <div className="round-icon blue"><CodeOutlined /></div><h2>问题解答</h2>
      <div className="faq-list"><article><h3>LShell 还提供 Web 版本吗？</h3><p>不再提供公开 Web 工作台。LShell 以 macOS 和 Windows 桌面客户端交付，通过加密连接访问 LShell 服务端，再连接你的服务器。</p></article><article><h3>LShell 会替我自动执行所有命令吗？</h3><p>不会。普通命令照常由你控制；中文意图会先生成方案，并根据风险等级决定直接执行或请求确认。</p></article><article><h3>它适合什么样的服务器？</h3><p>适合通过 SSH 管理的 Linux 服务器，尤其是需要频繁查看文件、Nginx、防火墙和运行状态的场景。</p></article></div>
    </section>

    <section className="download-section" id="download">
      <p>DESKTOP DOWNLOAD</p><h2>下载 LShell</h2><span className="download-lead">工作台只在你的电脑上运行。选择平台，安装后即可连接服务器。</span>
      <div className="download-grid">
        <a href={macDownload}><AppleOutlined /><div><strong>macOS</strong><span>Apple Silicon · macOS 12+</span></div><DownloadOutlined /></a>
        <a href={windowsDownload}><WindowsOutlined /><div><strong>Windows</strong><span>64 位 · 当前版本 v0.1.2</span></div><DownloadOutlined /></a>
      </div>
      <small>macOS 当前版本 v0.1.5 · Windows 当前可用版本 v0.1.2</small>
    </section>
    <section className="final-cta"><p>REMOTE OPERATIONS, WITH CONTEXT.</p><h2>远程工作，<br />也可以轻松而清楚。</h2><a href="#download">选择你的客户端 <ArrowRightOutlined /></a></section>
    <footer><a className="moe-brand" href="#top"><span><CodeOutlined /></span><strong>LShell</strong></a><p>© 2026 LShell Remote Workspace</p></footer>
  </main>;
}
