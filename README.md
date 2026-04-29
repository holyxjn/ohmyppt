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
- [内置 30+ 风格 Skill](#style-skills)
- [动画支持](#animations)
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
- 📄 **从文档创建** — 也支持上传 txt、md、csv、docx 文档，自动整理主题、页数和详细描述，生成时**继续参考原文件内容生成创意PPT**
- 📥 **导入 PPTX 编辑** — 可把本地 PPTX 转成应用内 HTML 页面，继续预览、调整位置和对话修改
- 🔒 **本地优先** — 全部跑在自己电脑上，不用注册、不用担心数据泄露
- 🎨 **内置 30+ 风格SKILL** — 极简白、赛博霓虹、包豪斯、日式简约、小红书白… 也支持自定义风格
- ✏️ **对话式修改** — 对着某一页说"标题换个颜色""加个数据图表"，精准修改不用重做
- 🎬 **动画演示** — 支持页面切换动画，也支持基于 Anime.js v4 的基础整元素动画
- 🧮 **数学公式渲染** — 支持常见 LaTeX 公式显示，适合课堂、教学、技术分享等场景
- 📄 **多格式导出** — 支持 PDF、批量 PNG，并提供可编辑 PPTX 导出（持续优化中）
- 🏷️ **会话管理** — 会话列表可区分 AI 创建和 PPTX 导入，也支持修改演示稿名称
- 🧩 **更稳的页面生成** — 生成时会按固定 16:9 画布与内容高度预算组织页面，减少内容溢出

<p>
 <img width="600" alt="Oh My PPT - 9" src="./docs/images/9.png" />
</p>

<p align="center">
<img width="45%" alt="Oh My PPT - 10" src="./docs/images/10.png" />
<img width="45%" alt="Oh My PPT - 11" src="./docs/images/8.png" />
</p>


<a id="workflow"></a>
## 🔄 使用流程

> 💡 输入你的需求或上传文档 → AI 会规划大纲 → 生成视觉风格 → 逐页渲染 → 预览 & 对话修改 → 导出 PDF / PNG / PPTX

也可以在首页点击「上传文档解析」，让应用先从文档中整理出主题、页数和详细描述。适合把方案文档、需求说明、会议材料、CSV 数据说明等快速变成一份可继续编辑的演示稿（**继续参考原文件内容生成PPT**）。

文档解析会更认真地检查大纲和页数是否一致：例如大纲里写了 5 页，创建页也会尽量填成 5 页。你的文档只会保存在本地工作目录中，应用会把它整理成 AI 更容易读取的文本。

如果已经有现成的 PPTX，也可以在首页点击「导入 PPTX」，把文件转换成应用里的可编辑页面。导入链路独立于 AI 生成，不会改变文档解析或正常生成流程。

如果没有文档，也可以直接填写主题和详细描述，应用会按你的需求进行 AI 创意生成。

<a id="style-skills"></a>
## 🎨 内置 30+ 风格 Skill
<img src="./docs/images/4.png" alt="Oh My PPT" width="500" />



<a id="animations"></a>
## 🎬 动画支持

Oh My PPT 的页面是 HTML 幻灯片，内置本地 **Anime.js v4** 动画运行时。生成或编辑页面时，可以让 AI 为页面里的整块元素添加基础演示动画，例如标题、数据卡片、图片、图表容器、步骤模块等。

更推荐使用“整个元素”的动画，而不是把文字拆成很多碎片逐字乱动。这样画面更稳、可读性更好，也更适合汇报、路演和课堂演示。

目前更适合使用这些基础整元素动画：

- **淡入**：模块出现时轻量过渡。
- **轻微位移入场**：从上、下、左、右短距离滑入，适合标题、卡片和列表。
- **缩放强调**：关键数字或结论卡片轻微放大后回落。
- **简单错峰**：多张卡片或多条要点按顺序依次出现。

动画主要用于引导视线和表达层级，不建议做复杂时间线、高频闪烁、无限循环或大幅抖动。页面初始状态也会尽量保持可读，避免“没有动画就看不到内容”的情况。

<img src="./docs/video/anime.gif" alt="Oh My PPT animation demo" width="600" />

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
- 项目默认不使用 thinking / reasoning 模式。配置自定义 OpenAI 兼容 `base_url` 时，应用会自动请求关闭 thinking，避免工具调用、文档解析和重试生成时出现 `reasoning_content` 兼容问题。


<a id="usage-notes"></a>
## 关于使用问题汇总

<a id="config"></a>
### 别忘了填写你的配置
 > 推荐： 小米mimo、deepseek、kimi、doubao、qwen、glm等等更多国产模型、以及gpt、claude
 
 > 小米mimo排第一绝对不是因为给了我7亿token 🐶🐶

  在「设置」页面填写你的模型配置，否则会报错。 

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
- **PPTX**：导出为可在 PowerPoint / Keynote 中继续编辑的文件。当前会尽量保留文字、图片、颜色、公式和基础布局，并持续优化文字重叠、混排和复杂图表的效果。

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
