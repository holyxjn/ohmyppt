<div align="center">
  <img src="thumb.png" alt="Oh My PPT" width="200" />
  <br/>
  <br/>

![AI PPT Generator](https://img.shields.io/badge/AI%20PPT-Generator-2f6d49)
![Local-first](https://img.shields.io/badge/Local--first-Private-3b7a57)
![License](https://img.shields.io/badge/license-MIT-green)
![Electron](https://img.shields.io/badge/Electron-Desktop-47848f)
![React](https://img.shields.io/badge/React-App-61dafb)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6)

**Oh My PPT - 纯本地 AI 幻灯片生成与编辑工具**

[English](./README_EN.md) | [为什么做这个](#why) • [能做什么](#features) • [使用流程](#workflow) • [更新日志](./CHANGELOG.md) • [使用问题](#usage-notes)

  <p>
    Local-first AI Slide Deck Generator<br/>
    Runs locally · AI-powered creation<br/>
    Prompt in → Deck out 👇
  </p>

  <img src="https://arcsin1.github.io/ohmyppt.gif" alt="Oh My PPT" width="600" />

  [观看完整演示视频](https://arcsin1.github.io/ohmyppt.mp4) | [下载安装包](https://github.com/arcsin1/oh-my-ppt/releases)
</div>

---

## 目录

- [为什么做这个](#why)
- [能做什么](#features)
- [使用流程](#workflow)
- [支持本地 Ollama 模型](#ollama)
- [使用问题汇总](#usage-notes)
  - [别忘了填写你的配置](#config)
  - [如何添加图片到 PPT 中](#assets)
  - [关于预览模式](#preview)
  - [关于导出](#export)
- [未签名应用打不开的问题](#unsigned-app)
- [需求反馈](#feedback)
- [参考](#references)
- [License](#license)

---

<a id="why"></a>
## 🎯 为什么做这个

每次要做分享/汇报/路演/答辩就头疼，纠结PPT排版占了大半时间

市面上AI PPT工具虽然多，但大多生成的是固定格式文件，想微调样式或加入自己想要的动画演示都很麻烦

所以自己写了一个Html版的PPT生成器——初衷是给自己做个工具使用（其实发现写简历模版也可以用）

生成的是HTML版PPT：打开即预览、无需软件、一个浏览器搞定，还能随心改样式/加动效/插代码/导出分享

<a id="features"></a>
## ✅ 能做什么

- 💬 **一句话生成** — 输入主题和需求，AI 自动规划大纲 + 配色 + 排版，直接出完整 PPT
- 🔒 **本地优先** — 全部跑在自己电脑上，不用注册、不用担心数据泄露
- 🎨 **内置 30+ 风格SKILL** — 极简白、赛博霓虹、包豪斯、日式简约、小红书白… 也支持自定义风格
- ✏️ **对话式修改** — 对着某一页说"标题换个颜色""加个数据图表"，精准修改不用重做
- 🎬 **页面切换动画** — 预览时页面切换自带过渡动画，演示效果拉满
- 📄 **多格式导出** — 支持 PDF、批量 PNG，并提供可编辑 PPTX 导出（持续优化中）
- 🧩 **更稳的页面生成** — 生成时会按固定 16:9 画布与内容高度预算组织页面，减少内容溢出

<img width="500" alt="Oh My PPT" src="./docs/images/6.png" />


<a id="workflow"></a>
## 🔄 使用流程

> 💡 输入你的需求 → AI 会规划大纲 → 生成视觉风格 → 逐页渲染 → 预览 & 对话修改 → 导出 PDF / PNG / PPTX

### 内置30+风格SKILL
<img src="./docs/images/4.png" alt="Oh My PPT" width="500" />



<a id="ollama"></a>
## 🦙 支持本地 Ollama 模型（OpenAI 兼容）

项目支持通过 **OpenAI 兼容协议** 接入本地 Ollama。

在「设置」页面这样填写即可：

- `provider`: `openai`
- `base_url`: `http://127.0.0.1:11434/v1`
- `model`: 你本地拉取的模型名（例如 `qwen2.5-coder:14b`），建议支持 14B+（或云端强模型）
- `api_key`: 任意非空字符串（例如 `ollama`）

说明：

- Ollama 默认不校验 API Key，但应用侧会做“非空”校验，所以不能留空。
- 推荐使用 14B+（或云端强模型）做接入生成。


<a id="usage-notes"></a>
## 关于使用问题汇总

<a id="config"></a>
### 别忘了填写你的配置

  在「设置」页面填写你的配置，否则会报错。 

  <img src="./docs/images/3.png" alt="Oh My PPT" width="500" />



<a id="assets"></a>
### 如何添加图片到 PPT 中

   注：图片或者素材只会复制到你的本地创意目录，不会上传到云端
 
  <img src="./docs/images/5.png" alt="Oh My PPT" width="500" />

<a id="preview"></a>
### 关于预览模式
   
   支持键盘（左右键）切换，支持演示模式，全屏演示模式，ESC退出演示模式
  
  <img src="./docs/images/2.png" alt="Oh My PPT" width="500" />

<a id="export"></a>
### 关于导出

目前支持三种导出方式：

- **PDF**：适合直接分享、归档和打印。
- **PNG**：一键批量导出所有页面图片，适合插入文档、Notion、公众号或社媒内容。
- **PPTX**：导出为可在 PowerPoint / Keynote 中继续编辑的文件。当前会尽量保留文字、图片、颜色和基础布局，但复杂 HTML、动画和部分图表还在持续优化中。

<img src="./docs/images/6.png" alt="Oh My PPT" width="500" />

<a id="unsigned-app"></a>
## 📦 未签名应用打不开的问题

目前发布包可能还没有进行系统级代码签名，所以 macOS 或 Windows 第一次打开时可能会出现安全提示。这个提示通常不是应用损坏，而是系统对“未签名/未公证应用”的默认拦截。

### macOS

如果 macOS 提示“无法打开”“已损坏”“无法验证开发者”，可以按下面任意一种方式处理。

**方式一：右键打开**

1. 打开「访达」或「应用程序」文件夹。
2. 找到 `OhMyPPT.app`。
3. 右键点击应用，选择「打开」。
4. 在弹窗里再次点击「打开」。

这种方式通常只需要做一次，之后就可以正常双击打开。

**方式二：清除隔离属性**

如果右键打开仍然不行，可以在终端执行：

```bash
xattr -cr /Applications/OhMyPPT.app
```

然后重新打开应用。

如果你把应用放在了其他目录，请把命令里的路径替换成实际路径，例如：

```bash
xattr -cr ~/Downloads/OhMyPPT.app
```

### Windows

Windows 可能会因为安装包未签名而触发 SmartScreen 提示，例如“Windows 已保护你的电脑”。这是未签名应用常见的系统提示。

处理方式：

1. 在提示窗口点击「更多信息」。
2. 确认应用名称是 `OhMyPPT`。
3. 点击「仍要运行」。

如果下载后被浏览器或杀毒软件拦截，可以先确认安装包来自本项目的 GitHub Releases 页面，再选择保留或允许运行。

> 建议只从官方 Release 地址下载安装包，避免使用第三方转存文件。

<a id="feedback"></a>
## 🙌 需求反馈

如果你有新需求、功能建议或发现问题，欢迎在仓库提交 Issue或者联系v:zijian798086。

我会持续跟进并优化体验。


<a id="references"></a>
## 参考

- [ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)
- [html-ppt-skill](https://github.com/lewislulu/html-ppt-skill)

<a id="license"></a>
## License

This project is licensed under the [MIT License](LICENSE) © 2026 arcsin1 &lt;zy19931129@gmail.com&gt;.
