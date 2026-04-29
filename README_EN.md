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

**Oh My PPT - Local-first AI Slide Deck Generator & Editor**

[中文](./README.md) | [Why](#why) • [Features](#features) • [Workflow](#workflow) • [Changelog](./CHANGELOG.md) • [Reference](#reference) • [Usage Notes](#usage-notes)

  <p>
    Local-first AI Slide Deck Generator<br/>
    Runs locally · AI-powered creation<br/>
    Prompt in → Deck out 👇
  </p>

  <img src="https://arcsin1.github.io/ohmyppt.gif" alt="Oh My PPT" width="600" />

  [Watch demo video](https://arcsin1.github.io/ohmyppt.mp4) | [Download release package](https://github.com/arcsin1/oh-my-ppt/releases/)
</div>

---

## Table of Contents

- [Why I Built This](#why)
- [What It Can Do](#features)
- [Workflow](#workflow)
- [Animation Support](#animations)
- [Local Ollama Support](#ollama)
- [Usage Notes](#usage-notes)
  - [How to add images to PPT](#assets)
  - [About preview mode](#preview)
  - [About export](#export)
- [Opening Unsigned Apps](#unsigned-apps)
- [Feedback & Requests](#feedback)
- [Reference](#reference)
- [License](#license)

---

<a id="why"></a>
## 🎯 Why I Built This

Every time I needed to prepare a talk, report, pitch, or defense, most of the time went into layout tweaks.

There are many AI PPT tools, but most output fixed-format files. Fine-tuning styles or adding custom animation demos is still painful.

So I built my own HTML-based PPT generator, originally as a personal tool (and it turns out it also works well for resume templates).

Output is pure HTML slides: instant browser preview, no extra software, easy to tweak styles, add motion, embed code, and export to PDF / PNG / editable PPTX.

<a id="features"></a>
## ✅ What It Can Do

- 💬 **One-prompt generation** — Enter topic + requirements, AI plans outline + palette + layout, then generates a complete deck  
- 📄 **Document-based creation** — Upload txt, md, csv, or docx files to prepare topic, page count, and description automatically, then keep using the source document during generation
- 📥 **Import PPTX for editing** — Convert local PPTX files into in-app HTML pages, then continue previewing, adjusting positions, and chat-based editing
- 🔒 **Local-first** — Runs on your machine, no signup, no upload anxiety  
- 🎨 **30+ built-in style skills** — Minimal White, Cyber Neon, Bauhaus, Japanese Minimal, Xiaohongshu White, and more, plus custom styles  
- ✏️ **Chat-based editing** — Tell it “change title color” or “add a data chart” on a specific page, without rebuilding everything  
- 🎬 **Animation support** — Page transitions plus basic Anime.js v4-powered whole-element motion
- 🧮 **Math formula rendering** — Display common LaTeX formulas for classes, teaching decks, and technical talks
- 📄 **Multi-format export** — Export to PDF, batch PNG, or editable PPTX (still being improved)
- 🏷️ **Session management** — Session list distinguishes AI-created decks from imported PPTX decks, and deck names can be renamed
- 🧩 **More reliable slide layout** — Generation follows a fixed 16:9 canvas and content-height budget to reduce overflow


<p align="center">
 <img width="45%" alt="Oh My PPT - 7" src="./docs/images/7.png" />
 <img width="45%" alt="Oh My PPT - 6" src="./docs/images/8.png" />
</p>

<a id="workflow"></a>
## 🔄 Workflow

> 💡 Input your intent or upload a document → AI plans outline → generates visual direction → renders page by page → preview & chat edits → export PDF / PNG / PPTX

On the home page, you can use “Upload Document” to let the app extract the topic, page count, and detailed description first. It works well for product plans, requirement docs, meeting materials, and CSV-based notes that you want to turn into an editable deck.

Document parsing also checks whether the outline and page count match. For example, if the outline clearly contains five pages, the creation form will try to use five pages too. Your documents stay in the local workspace; the app only prepares them as AI-readable text.

If you already have an existing PPTX file, click “Import PPTX” on the home page to convert it into editable in-app pages. This import flow is independent from AI generation and does not affect document parsing or the normal generation workflow.

If you do not have a document, you can still enter a topic and description directly, and the app will generate the deck creatively from your request.

<a id="animations"></a>
## 🎬 Animation Support

Oh My PPT generates HTML slides and includes a local **Anime.js v4** runtime. During generation or chat-based editing, the AI can add basic presentation motion to whole slide elements such as titles, metric cards, images, chart containers, and step blocks.

Whole-element animation is preferred over splitting text into many tiny moving fragments. It keeps slides readable, stable, and better suited for reports, pitches, classes, and live demos.

The most reliable whole-element animations today are:

- **Fade in**: lightweight transitions when modules appear.
- **Subtle slide-in motion**: short movement from top, bottom, left, or right for titles, cards, and lists.
- **Scale emphasis**: gently enlarge key numbers or conclusion cards, then settle back.
- **Simple stagger**: reveal cards or bullets one after another.

Animations are meant to guide attention and show hierarchy. Avoid complex timelines, high-frequency flashing, infinite loops, or large shaking motion. Slides should remain readable even if animation is disabled.

<img src="./docs/video/anime.gif" alt="Oh My PPT animation demo" width="600" />

<a id="ollama"></a>
## 🦙 Local Ollama Support (OpenAI-Compatible)

This project supports local Ollama through the **OpenAI-compatible API**.

Fill the Settings page like this:

- `provider`: `openai`
- `base_url`: `http://127.0.0.1:11434/v1`
- `model`: your local model tag (for example `qwen2.5-coder:14b`), recommended 14B+ (or a strong cloud model)
- `api_key`: any non-empty string (for example `ollama`)

Notes:

- Ollama does not validate API keys by default, but this app enforces a non-empty check, so `api_key` cannot be blank.
- 14B+ local models (or strong cloud models) are recommended for stable generation quality.
- The app does not use thinking / reasoning mode by default. When a custom OpenAI-compatible `base_url` is configured, the app asks the provider to disable thinking so document parsing, tool calls, and retry generation avoid `reasoning_content` compatibility issues.

<a id="usage-notes"></a>
## Usage Notes

<a id="assets"></a>
### How to add images to PPT

Images and assets are copied into your local session directory. They are not uploaded to a cloud service by this app.

<img src="./docs/images/5.png" alt="Oh My PPT" width="500" />


<a id="preview"></a>
### About preview mode

Supports keyboard navigation (Left/Right), presentation mode, fullscreen presentation mode, and `ESC` to exit presentation mode.

<img src="./docs/images/2.png" alt="Oh My PPT" width="500" />

<a id="export"></a>
### About export

Oh My PPT currently supports three export modes:

- **PDF**: best for sharing, archiving, and printing.
- **PNG**: batch-export every slide as an image for docs, Notion, articles, or social posts.
- **PPTX**: export an editable file for PowerPoint / Keynote. Text, images, colors, formulas, and basic layout are preserved where possible, while text overlap, mixed-language layout, complex HTML, animation, and some charts are still being improved.

Export uses a static slide state where possible, so entrance animations are less likely to affect PDF or image output.

<a id="unsigned-apps"></a>
## 📦 Opening Unsigned Apps

Release builds may not be code-signed yet, so macOS or Windows can show security warnings on first launch. This usually does not mean the app is broken; it is the operating system blocking unsigned or unnotarized software by default.

### macOS

If macOS says the app cannot be opened, is damaged, or cannot verify the developer, use either option below.

**Option 1: Right-click Open**

1. Open Finder or the Applications folder.
2. Find `OhMyPPT.app`.
3. Right-click the app and choose **Open**.
4. Click **Open** again in the confirmation dialog.

This usually only needs to be done once.

**Option 2: Clear the quarantine attribute**

If right-click Open still does not work, run:

```bash
xattr -cr /Applications/OhMyPPT.app
```

Then open the app again.

If you placed the app somewhere else, replace the path with the actual location, for example:

```bash
xattr -cr ~/Downloads/OhMyPPT.app
```

### Windows

Unsigned installers may trigger Windows SmartScreen, such as “Windows protected your PC”. This is expected for unsigned apps.

Steps:

1. Click **More info**.
2. Confirm the app name is `OhMyPPT`.
3. Click **Run anyway**.

If your browser or antivirus blocks the file, first confirm the installer came from this project’s GitHub Releases page, then choose to keep or allow the file.

> Download builds only from the official Releases page when possible.

<a id="feedback"></a>
## 🙌 Feedback & Requests

If you have new requirements, feature ideas, or bug reports, feel free to open an Issue in this repository.

I will keep following up and improving the experience.

## Reference

- [ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)
- [html-ppt-skill](https://github.com/lewislulu/html-ppt-skill)

## License

This project is licensed under the [MIT License](LICENSE) © 2026 arcsin1 &lt;zy19931129@gmail.com&gt;.
