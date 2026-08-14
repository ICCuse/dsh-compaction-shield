# @deepseek-ai/dsh-compaction-shield

[English](README.md) | 中文

让压缩**在构造上无损**。生态里所有记忆插件都是被动存储（模型必须先调 `memorize`）；所有压缩补救都是事后抢救。本插件是缺失的主动半边：`compaction/summary` 发生时，把被压区间的关键字面锚点**自动存档进会话笔记文件**（无损字节），再注入一条召回提醒，告诉模型它们在哪。

## 为什么

压缩每轮从头重写 head checkpoint，摘要逐代再摘要——关键前提（路径、数值、错误码）会模糊掉。摘要丢掉的东西无法可靠找回，但你**可以在被压之前**把关键字面量搬进无损存储。这就是本插件做的事，全自动，不依赖模型自觉。

## 工作机制

| 钩子 | 作用 |
|---|---|
| `session/event`（`compaction/summary`） | 用 `shadowedSeqs` 导出被压区间文本，提取特征锚点（路径/引号字面量/key=value/错误码），去重后追加到 `<cwd>/.dsh-notes/<session>.md`（`recall` 读的同一文件），带 `compaction-shield` 标记行。 |
| `agent/pre-step` | 注入一次性召回提醒，点名已存档锚点；新的用户提示跳过投递。 |

无 LLM 调用、无新存储词汇；存档尽力而为（写失败仍会投递提醒）。

## 组合

- `dsh-file-memory` —— `recall` 读同一笔记文件；盾是自动写者，file-memory 是读者。
- `dsh-premise-guard` —— 对"仍然消失"的锚点告警；盾从源头防止消失。合起来：模型视角下没有任何关键内容会丢。

## 配置

| 字段 | 默认 | 含义 |
|---|---|---|
| `maxAnchors` | `6` | 每次压缩存档的锚点数。 |
| `minAnchorLength` | `6` | 短于此长度的锚点永不存档。 |

两者必须为 `>= 1` 的整数；配置错误在插件加载时直接抛错。

## 安装

尚未发布到 npm —— 直接从此仓库安装：

```sh
npm install github:ICCuse/dsh-compaction-shield
# 或：pnpm add github:ICCuse/dsh-compaction-shield
```

然后在 profile 组装中挂载（package.json 已声明 `dsh.bundle`）：

```yaml
- id: dsh-compaction-shield
  name: 'dsh-compaction-shield'
```

发布后亦可 `dsh plugin --profile web add dsh-compaction-shield`。
