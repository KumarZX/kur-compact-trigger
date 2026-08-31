# kur-compact-trigger

[![DSH Plugin](https://img.shields.io/badge/DSH-Plugin-2563eb)](https://github.com/topics/dsh-plugin)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek-Harness-111827)](https://github.com/deepseek-ai/deepseek-harness)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Category / 分类：** `dsh-plugin` · DeepSeek Harness 第三方插件

Session-level auto compaction trigger for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Before each turn, it measures context tokens and calls the official `compaction` service when the threshold is reached.

会话级自动压缩触发器。每轮对话开始前用 `tokenMeter` 计量上下文；超过阈值时调用官方 `compaction` 服务压缩旧消息。

---

## English

### What it does

This plugin does **not** invent its own summarizer. It only decides *when* and *which range* to compact, then calls `compaction.compactRegion()` from `@deepseek-ai/dsh-compaction-basic`.

| Setting | Default | Meaning |
|---|---|---|
| `thresholdTokens` | `200000` | Compact when session tokens reach this value |
| `retainTokens` | `32000` | Keep roughly this many recent tokens verbatim |
| `maxAttempts` | `3` | Max compact loops in one turn |
| `sessions.<id>` | — | Optional per-session overrides |

The compact cut is moved to a **tool-call / tool-result pairing boundary** so a tool result is not split from its call.

It lives on the **host plane** so every agent preset shares it. It does **not** inject `compaction` (that service lives in the preset realm; injecting it on host would stall the plugin tree). At `agent/pre-step` it resolves the current preset via `ctx.agentPresets.serviceFor(agent, 'compaction')`.

### Screenshots

Header button — open per-session threshold without leaving the chat:

![Header compact button](docs/screenshot-header.png)

Session override — leave fields blank to follow global settings:

![Session compact threshold](docs/screenshot-session.png)

Settings → **Auto Compact** — global defaults; slider max follows the model context window:

![Global auto-compact settings](docs/screenshot-settings.png)

### Install

1. Copy this package to `~/.dsh/profiles/node_modules/kur-compact-trigger/` (or `npm pack` / clone into that path).
2. Merge [examples/cordis.patch.yml](examples/cordis.patch.yml) into each profile’s `cordis.patch.yml` (`desktop`, `web`, `feishu`, …).
3. Add [examples/settings.yaml](examples/settings.yaml) under `kur-compact-trigger:` in `~/.dsh/settings.yaml` (and profile-specific settings if needed).
4. Restart DSH Desktop / the profile process.

You can also change values in **Settings → Auto Compact**, or from the chat header **Compact** control.

### Note on official auto-compact

`@deepseek-ai/dsh-compaction-basic` defaults to `auto: true` at **80% of the model context window**. That path can fire independently of this plugin. If your chat model’s window is 128k, 80% ≈ 102k — often *before* this plugin’s 200k threshold. Tune one side or disable official `auto` if you want a single policy.

### License

MIT

---

## 中文

### 做什么

本插件**不实现摘要模型**，只决定**何时、压哪一段**，然后调用官方 `@deepseek-ai/dsh-compaction-basic` 的 `compaction.compactRegion()`。

| 配置 | 默认 | 含义 |
|---|---|---|
| `thresholdTokens` | `200000` | 会话总 token 达到此值时压缩 |
| `retainTokens` | `32000` | 尽量保留尾部最近约这么多原文 token |
| `maxAttempts` | `3` | 同一轮最多连压几次 |
| `sessions.<id>` | — | 可选，按会话覆盖 |

切分点会挪到**工具调用 / 工具结果配对平衡**处，避免把一次 tool 拆开。

插件挂在 **host 平面**，所有 preset 共用。**不要 inject `compaction`**（该服务在 preset realm；host 上 inject 会一直 pending）。在 `agent/pre-step` 里用 `ctx.agentPresets.serviceFor(agent, 'compaction')` 取当前 preset 实例。

### 截图

会话标题栏入口，不离开对话即可改本会话阈值：

![标题栏压缩阈值](docs/screenshot-header.png)

本会话覆盖；留空则跟随全局：

![本会话压缩阈值](docs/screenshot-session.png)

设置 → **自动压缩**：全局默认；滑条上限跟随模型上下文窗口：

![全局自动压缩设置](docs/screenshot-settings.png)

### 安装

1. 把本包放到 `~/.dsh/profiles/node_modules/kur-compact-trigger/`（或 clone / `npm pack` 到该路径）。
2. 将 [examples/cordis.patch.yml](examples/cordis.patch.yml) 合并进各 profile 的 `cordis.patch.yml`（`desktop` / `web` / `feishu` 等）。
3. 在 `~/.dsh/settings.yaml` 写入 [examples/settings.yaml](examples/settings.yaml) 的 `kur-compact-trigger:` 段（profile 独立 settings 同样需要时再写一份）。
4. 重启 DSH Desktop 或对应 profile。

也可在 **设置 → 自动压缩**，或会话标题栏 **压缩阈值** 里改。

### 与官方自动压缩的关系

官方 `@deepseek-ai/dsh-compaction-basic` 默认 `auto: true`，阈值是**模型窗口的 80%**。它和本插件是两条线。若聊天模型窗口是 128k，80% ≈ 102k，往往会**早于**本插件的 20 万阈值先动手。若只想保留一套策略，请调其中一侧，或关掉官方 `auto`。

### 许可证

MIT
