<h1 align="center">
  QuickAI
</h1>

<p align="center">
  <img src="public/quickai-logo.png" alt="QuickAI logo" width="300" />
</p>

<p align="center">
  面向 Windows 的双语（English + 简体中文）AI 助手浮层，由云端模型驱动。
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" alt="许可证" /></a>
  <img src="https://img.shields.io/badge/platform-Windows-0078D4?logo=windows11&logoColor=white" alt="平台：Windows" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Tauri-v2-24C8DB?logo=tauri&logoColor=white" alt="Tauri v2" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Rust-stable-CE422B?logo=rust&logoColor=white" alt="Rust" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white" alt="Tailwind CSS 4" />
  <img src="https://img.shields.io/badge/SQLite-bundled-003B57?logo=sqlite&logoColor=white" alt="SQLite" />
</p>

---

> ## 这是 QuickAI 的一个分支
>
> **QuickAI 是 [ayzekhdawy](https://github.com/ayzekhdawy) 的
> [ThukiWin](https://github.com/ayzekhdawy/thukiwin) 的分支**（ThukiWin 本身是
> Logan Nguyen 的 [Thuki](https://github.com/quiet-node/thuki) 的 Windows 移植版）。
> 所有原始设计与代码的版权归上游作者所有。
>
> QuickAI 在此基础上改造为一个**纯云端**、**双语**的助手：本地 Ollama 推理、
> 自建网页搜索管线、本地网关，以及语音朗读 / 音效功能都已被移除。本分支的缺陷
> 反馈与功能建议请提交到[本仓库](https://github.com/yorelll/quickai/issues)，而非上游。

## QuickAI 是什么

QuickAI 是一个轻量的 Windows 浮层，把 AI 助手悬浮在你正在做的事情之上。双击你的
召唤键（默认 <kbd>Ctrl</kbd>，可自定义）即可从任意应用中唤起它——包括全屏应用——
提问、得到回答、随即收起。先选中一段文字，QuickAI 打开时会把它作为引用预填好。

它是**纯云端**的：你自带 OpenAI、Anthropic 或 OpenAI 兼容服务的 API Key，并配置
一个模型，所有请求都直接发往该服务商。你的对话与 API Key 都保存在本地 SQLite
数据库中；除了你配置的服务商之外，不会发送到任何其他地方。

## 功能

- **随处唤起：** 双击你的召唤键（<kbd>Ctrl</kbd>、<kbd>Alt</kbd>、<kbd>Shift</kbd>
  或 <kbd>Win</kbd>，任你选择）即可在任意应用（包括全屏应用）之上打开或置前浮层；
  从迷你条恢复时不会重开当前会话。设计上，无论浮层是隐藏、已缩成迷你条还是已经在
  前台，**一次双击**都足够；热键判定与浮层状态机有自动化测试覆盖，但在部分机器上
  仍可能需要在「点击别处收起」之后再双击一次——0.0.7 起可回传诊断日志帮助定位这一
  残留问题。
- **结合上下文的引用：** 选中文字后唤起 QuickAI，它会以引用形式预填选中的内容。
- **云端服务商：** OpenAI、Anthropic，以及任意 OpenAI 兼容端点（自定义 Base URL、
  模型与 API Key）。在设置中配置。
- **双语界面：** 英文与简体中文，根据系统语言自动检测，并可在设置中切换。
- **深色与浅色主题：** 在设置 → **General** 标签页的**外观**分区中选择**深色**
  （默认）或**浅色**。切换立即生效，无需重启。代码块也会跟随主题进行语法高亮。
- **技能（Skills）与 `/add`：** 在设置 → **AI** 标签页的**技能**分区管理技能
  （别名 / 路径 / 是否用作系统提示词），可添加、编辑、删除与排序。在对话中输入
  `/add` 打开技能选择器：按 <kbd>Enter</kbd> 添加并清空输入框，按
  <kbd>Ctrl</kbd>+<kbd>Enter</kbd> 添加后继续留在选择器里多选；已选技能以带 **×**
  的标签显示在输入框上方，并随消息一起发送。输入 `/add <别名>` 可直接调用该技能。
  技能路径会经过校验：仅支持 `.txt`、`.md` 与 `.markdown` 文件，文件夹会被拒绝，
  首尾成对的引号会被自动剥除。**同一轮里重复选择同一个技能，只会发送一份。** 技能
  加载或保存失败时会以可关闭的弹窗提示：关闭后不再出现，未关闭的在重新打开设置时仍会
  出现。
- **主对话与视觉：** 流式回复；附加图片或截取屏幕，都会作为视觉输入发送给模型。
- **安静的会话切换：** 打开历史或切换会话时，记录直接静止显示，不重放入场动画；
  只有新追加的消息会播放。召唤浮层本身的动画不受影响。
- **扩展推理：** 输入 `/think`，让模型在作答前逐步推理。
- **电脑操控（`/do`）：** 让 AI 接管你的桌面并自主完成任务，使用 OpenAI / Anthropic
  原生工具调用。智能体还可以**列举文件夹**（仅返回名称与类型，最多 200 条）来发现
  路径，而不是靠猜；该操作在 Limited 模式下始终需要批准。权限可选 **Limited**
  （安全操作自动执行，危险操作先询问）或 **Full**（从不询问），并且可以用键盘允许、
  拒绝或中止。
- **实用命令：** `/translate`、`/rewrite`、`/tldr`、`/refine`、`/bullets`、`/todos`。
- **对话历史：** 本地持久化，可跨会话重新打开；可在对话标题处重命名，也可在历史
  列表中重命名 / 删除条目。
- **固定窗口：** 点击窗口之外时保持浮层不隐藏。
- **迷你栏模式：** 当你切换窗口时，浮层会收缩为一条细长的置顶条，让你始终能掌握它。
  点击它，或再双击一次召唤键，即可恢复完整浮层；恢复时不会重开当前会话。
- **桌面通知：** 当你在其他窗口时，回复完成后会弹出通知。
- **多显示器支持：** 截图与浮层定位在所有显示器上都能正常工作。

> **相对上游已移除：** 本地 Ollama 推理、自建网页搜索管线（`/search`）、本地
> OpenAI 兼容网关、语音朗读，以及通知音效选项。

## 系统要求

| 要求 | 最低配置 | 说明 |
|---|---|---|
| **操作系统** | Windows 10 64 位（1809+） | 推荐 Windows 11 |
| **内存** | 4 GB | 推理在云端进行 |
| **磁盘** | 约 200 MB（应用） | 另需本地对话数据库的存储空间 |
| **API Key** | 必需 | OpenAI、Anthropic 或 OpenAI 兼容服务商 |
| **模型** | 必需 | 没有默认模型——开始对话前需在设置 → AI 标签页中设置 |

### 构建要求（从源码构建）

- [Bun](https://bun.sh) v1.3+
- [Rust](https://rustup.rs) 稳定版工具链
- [Microsoft Visual Studio Build Tools 2022](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
  （含 MSVC v143 的 C++ 构建工具 + Windows 10/11 SDK）

## 下载

每个版本都会发布两个安装包，任选其一：

### 方式一 —— NSIS 安装程序（推荐）

1. 从[最新版本](https://github.com/yorelll/quickai/releases/latest)下载
   `QuickAI_<version>_x64-setup.exe`。
2. 运行安装程序。
3. 从开始菜单或桌面快捷方式启动 QuickAI。它会出现在系统托盘中。

### 方式二 —— 便携版 zip（免安装）

1. 从[最新版本](https://github.com/yorelll/quickai/releases/latest)下载
   `QuickAI_<version>_x64_portable.zip`。
2. 解压到任意位置，运行 `quickai.exe`。

便携版与安装版使用同一个按用户区分的应用数据目录，因此你可以在两者之间自由切换。

> **Windows 上无需任何特殊权限。** 全局热键与屏幕截图开箱即用，不存在辅助功能或
> 屏幕录制之类的权限门槛。

## 快速上手

首次启动时，打开**设置**（齿轮图标，或按 <kbd>Ctrl</kbd>+<kbd>,</kbd>），在 **AI**
标签页中配置服务商：

1. 选择服务商：**OpenAI**、**Anthropic** 或 **OpenAI-compatible**。
2. 填入你的 **API Key**（保存在 QuickAI 本地的 SQLite 数据库中）。
3. **填入模型**——没有默认值，该字段初始为空（只显示占位提示）。若使用
   OpenAI-compatible 服务商，还需填入 Base URL。
4. 可选：在 **General** 标签页中调整召唤热键、界面语言、主题、数据目录与开机自启。
5. 可选：在 **AI** 标签页的**技能**分区中添加技能（别名 + 文件路径），并在对话中用
   `/add` 调用它们。
6. 可选：在 **Agent** 标签页中配置 **agent 模式**：保持 *Same as AI
   configuration*，或切换为 *Custom* 以使用独立的服务商 / 模型 / Base URL / Key，
   并选择 **Limited** 或 **Full** 权限。

然后双击你的召唤键即可开始提问。**About** 标签页提供**快捷键与命令**和**帮助**
两个弹窗（点击后在可滚动的弹窗中查看）。

## 从源码构建

```powershell
# Clone and install dependencies
git clone https://github.com/yorelll/quickai.git
cd quickai
bun install

# Launch in development mode
bun run dev
```

生成发布构建（前端 + NSIS 安装程序）：

```powershell
bun run build:all
```

产物：

- 安装程序：`src-tauri/target/release/bundle/nsis/QuickAI_<version>_x64-setup.exe`
- 独立可执行文件：`src-tauri/target/release/quickai.exe`

> 该本地构建仅供开发使用。可发布的正式产物由 CI 生成，而非 `bun run build:all`
> —— 参见 [RELEASING.md](RELEASING.md#release-artifacts)。

## 配置

QuickAI 会读取少量环境变量。把 `.env.example` 复制为 `.env`（已被 git 忽略）并按需
调整。

| 变量 | 说明 | 默认值 |
|---|---|---|
| `VITE_QUOTE_MAX_DISPLAY_LINES` | 引用预览显示的最大行数。 | `4` |
| `VITE_QUOTE_MAX_DISPLAY_CHARS` | 引用预览显示的最大字符数。 | `300` |
| `VITE_QUOTE_MAX_CONTEXT_LENGTH` | 作为提示上下文发送的选中文本最大字符数。 | `4096` |

服务商设置（服务商、模型、Base URL）、API Key、技能（Skills，存于
`skills.toml`），以及 General 标签页中的选项（热键、语言、主题、数据目录、开机
自启），都在应用内的**设置**窗口（及其 `config.toml`）中配置，而不是通过环境变量。
这些文件与诊断日志 `quickai.log` 都位于 `%APPDATA%\com.yorelll.quickai\`，日志
的用途见下文〈诊断日志〉。

完整参考见 [docs/configurations.md](docs/configurations.md)，斜杠命令参考见
[docs/commands.md](docs/commands.md)。

## Windows 相关细节

### 热键

QuickAI 使用 Windows 底层键盘钩子（`SetWindowsHookExW` 配合 `WH_KEYBOARD_LL`）来
全局检测召唤键的双击。这在所有应用中都能工作，包括全屏应用，以及 Windows 10
1809+ 上的提权（管理员）窗口。召唤键可在设置 → **General** 标签页中配置：
<kbd>Ctrl</kbd>（默认）、<kbd>Alt</kbd>、<kbd>Shift</kbd> 或 <kbd>Win</kbd>。

- **触发窗口：** 两次按下之间 400 毫秒
- **一次双击就够：** 无论浮层当前是隐藏、迷你条还是已在前台，召唤键都走同一条
  「打开或置前」路径。0.0.7 回传的运行时日志定位了残留的原因：**成功触发之后，
  那一下按键的抬起没有到达钩子**，内部「键是否按着」的状态卡在 `true`，下一次
  手势的第一下于是被当作自动重复吞掉、整组作废。现在每次按下都会**向系统核对
  键的真实物理状态**，另有 **1200 毫秒静默超时**兜底，陈旧的「按着」状态会被
  当作新的按压处理，而不是吞掉，因此这一状态可以自愈。若在你的机器上仍需要
  第二次双击，请回传诊断日志（见下文〈诊断日志〉）。
- **不会关闭浮层：** 召唤键只负责打开或置前。关闭请用 <kbd>Esc</kbd>、
  <kbd>Ctrl</kbd>+<kbd>W</kbd> 或窗口的关闭按钮。未固定窗口时，点击窗口之外会把
  浮层缩成迷你条，而不是隐藏。

### 诊断日志

QuickAI 把诊断写入 `%APPDATA%\com.yorelll.quickai\quickai.log`（与 `config.toml`、
`skills.toml` 同目录）。正常启动后，`[startup]` 启动横幅（版本、单实例判定、
**实际绑定的热键键码**、主窗口状态）、`[activator]`（钩子是否安装、每次按键的
判定）、`[summon]`、`[minibar]`（含 `shrink applied size=…`）与配置加载事件都会
直接写入，**不需要开启任何开关**；反馈缺陷时按原样附上即可。日志**不包含对话内容
或 API Key**。每行带 UTC 时间戳；文件达到 1 MiB 时轮转为 `quickai.log.1`。写入
失败会被静默丢弃，不会影响应用行为。前端尺寸明细 `[quickai:size]` 仅存在于开发
构建，正式发布版没有。

### 浮层窗口

QuickAI 结合 Tauri 的 `always_on_top`、`skip_taskbar` API 与 Win32 窗口样式，使其
悬浮于所有其他窗口之上，既不显示在任务栏中，也不抢走焦点。

### 屏幕截图

全屏截图使用 Windows GDI 的 `BitBlt` API。在对话中输入 `/screen` 即可截取屏幕并
作为上下文附加；QuickAI 自身的窗口会被排除在截图之外。

### 上下文捕获

当你在选中文字的状态下召唤 QuickAI（双击热键）时，QuickAI 会通过剪贴板模拟（经
`SendInput` 发送 Ctrl+C）捕获选中内容，然后恢复剪贴板原有内容。光标位置通过
`GetCursorPos` 读取，以便把浮层定位在光标附近。

### 电脑操控（agent 模式）

QuickAI 的 `/do` 命令（或诸如“打开记事本”这样的自然语言）让 AI 自主控制你的桌面：

1. **截屏** —— 截取你的屏幕（排除 QuickAI 自身的窗口）。
2. **分析** —— 把截图与你的任务发送给已配置的 agent 服务商。
3. **执行** —— 模型返回结构化的工具调用：鼠标与键盘操作经 Win32 `SendInput` 执行
   （点击、输入、按键、滚动、启动），**列举文件夹**则直接读取目录内容（仅名称与
   类型，不含文件内容）。
4. **重复** —— 再次截屏，循环持续，直到任务完成或你将其停止。

**安全：**

- 最多 30 次迭代，防止死循环。
- 每个操作之间间隔 500 毫秒，便于你跟进。
- 点击 **Stop**，或按 <kbd>Ctrl</kbd>+<kbd>C</kbd>，可随时中止。
- 授权策略来自设置 → Agent 标签页中的 **Agent permissions**：**Limited**（默认）
  自动执行安全操作，危险操作则先询问（启动程序、**列举文件夹**，或诸如
  <kbd>Win</kbd>+<kbd>R</kbd> 或 <kbd>Alt</kbd>+<kbd>F4</kbd> 之类的系统级按键）；
  **Full** 从不询问。文件夹列举之所以默认询问，是因为它是唯一一条静默、无窗口的
  读取通道。
- 当有待确认的操作时，按 <kbd>1</kbd> 允许、<kbd>2</kbd> 拒绝，或按
  <kbd>Ctrl</kbd>+<kbd>C</kbd> 中止——无需鼠标；也可用 <kbd>←</kbd>/<kbd>→</kbd>
  切换选择、<kbd>Enter</kbd> 确认（默认选中「允许」）。

### 迷你栏模式

当 QuickAI 正在生成回复或运行 agent 任务时你切换到别的窗口，浮层会收缩为一条
**迷你栏**——一条细长的置顶条。迷你栏显示一个状态点（绿色 = 空闲 / 完成，琥珀色
= 工作中，红色 = 出错）以及最近一条消息或操作的预览。点击它可恢复完整浮层。当你在
其他窗口时回复完成，会发送一条桌面通知。

## 架构与安全

<details>
<summary>点击展开</summary>

QuickAI 是一个 **Tauri v2** 应用（Rust 后端 + React/TypeScript 前端）。它没有自己
的后端服务：推理完全发生在你所配置的云端服务商处。

### 技术栈

- **前端：** React 19 + TypeScript + Tailwind CSS 4 + Vite
- **后端：** Rust 搭配 Tauri v2 + Win32 API（windows crate）
- **数据库：** SQLite（内置，仅本地）
- **AI：** OpenAI / Anthropic / OpenAI 兼容 HTTP API

### 安全模型

1. **前端（Tauri/React）：** 运行在安全的系统 WebView 中（Windows 上为 WebView2），
   IPC 受限。流式传输使用 Tauri 的 Channel API；Rust 后端发送带类型的
   `StreamChunk` 变体，前端把 token 累积进 React 状态。

2. **网络出口：** 唯一的网络请求发往你所配置的 AI 服务商（OpenAI、Anthropic 或你
   自定义的 OpenAI 兼容端点）。没有遥测，也没有第一方服务器。

3. **仅本地存储：** 对话与 API Key 保存在应用数据目录中的本地 SQLite 数据库里。
   Key 除了发往其所属的服务商之外，不会发送给任何人。

4. **agent 模式输入模拟：** 调用 `/do` 时，QuickAI 使用 Win32 `SendInput` 模拟鼠标
   与键盘事件。截图通过 GDI `BitBlt` 捕获，并以 base64 图片发送给已配置的服务商。
   不涉及任何远程控制或屏幕共享服务。

### 窗口生命周期

应用启动时会自动显示输入栏。双击召唤键可打开它或将它置于前台；设计上无论它处于
隐藏、迷你条还是前台状态都只需一次双击（0.0.8 起，丢失的抬起会让内部状态自愈，
见〈热键〉与〈诊断日志〉）；**召唤键不会关闭浮层**。关闭请按 <kbd>Esc</kbd>、
<kbd>Ctrl</kbd>+<kbd>W</kbd>，或点击窗口的关闭按钮。未固定窗口时，点击窗口之外会把
浮层缩成迷你条，而不是隐藏。关闭只是隐藏（而非退出）。

**单实例：** 同一时间只会运行一个 QuickAI。再次启动时，新进程会把激活转发给已在
运行的实例并立即退出，不会再注册一个全局键盘钩子，也不会建立第二个窗口。0.0.7
之前的版本没有这一保护，因此升级前请先退出所有旧实例。

**托盘图标：** 左键单击**打开或提起**浮层（不会隐藏）；右键单击打开菜单，其中只有
**设置**与**退出**（没有「打开」项，因为左键已经负责打开）。菜单文字跟随界面语言，
切换语言后立即生效，无需重启。

**窗口尺寸：** 高度按内容需求自动调整。聊天模式下顶栏与输入框固定，记录区吸收窗口
高矮的差异；手动拉高窗口后，它会回弹到内容所需的高度——这是有意行为。

</details>

## 参与贡献

欢迎贡献！请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 上手，并遵守[行为准则](CODE_OF_CONDUCT.md)。
发布流程见 [RELEASING.md](RELEASING.md)。

## 许可证

基于 [Apache License, Version 2.0](LICENSE) 授权。

## 致谢

- [ThukiWin](https://github.com/ayzekhdawy/thukiwin) —— 由
  [ayzekhdawy](https://github.com/ayzekhdawy) 开发，是本分支的直接上游。
- [Thuki](https://github.com/quiet-node/thuki) —— 由 Logan Nguyen 开发，是 ThukiWin
  移植所基于的原始 macOS 应用。
