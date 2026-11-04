# 小蓝 · 手机端轻记忆伴侣（PWA）

把电脑端 AI 助手的「人格 + 规则 + 记忆要点」搬到手机上，做成一个可以添加到主屏幕的网页 App。
不依赖任何后台服务器：**App 挂 GitHub Pages，数据挂你自己的私有仓库**，两端靠 GitHub 同步。

> 这是可自托管的开源项目：Fork 本仓库 → 开启 Pages → 建一个私有数据仓 → 跑一次脚本，你的手机就有一个只属于你的「小蓝」。

---

## 它能做什么

| 功能 | 说明 |
|---|---|
| 💬 聊天 | 直连 DeepSeek API，支持流式输出、思考深度、模型切换 |
| 🧠 记忆 | 从电脑端同步「人格 / 规则 / 风格 / 近况 / 分层摘要 / 长期事实」，对话时自动注入 |
| 🔍 记忆工具 | 模型可主动 `memory_search` 查旧记录、`memory_write` 记当天笔记、`memory_note` 记长期事实 |
| 🌐 联网 | 需要时自己调 `web_search`，贴链接可 `fetch_url` 读正文 |
| 🖼 图片 | 多模态直传，长图可选手动切块；单图上限 25MB，自动压缩到 2400px |
| 📄 PDF | 本机用 PDF.js 抽全文（带页码标记），按页提问 |
| 😄 表情 | 322 张表情清单 + 发送工具（可选） |
| 🎭 Markdown | 标题/表格/代码/引用 + KaTeX 公式（自建渲染，含 `%` 转义兜底） |
| 📴 离线 | Service Worker 缓存外壳，断网能看历史；写的笔记进本地队列，联网自动补传 |
| 🩺 诊断 | 应用内日志（400 条环形缓冲），可一键上传到私有仓供电脑排查 |

---

## 架构

```
┌──────────────┐   读 pack/*.md（只读）   ┌─────────────────┐
│  手机 PWA     │ ◄─────────────────────── │ dsh-memo-app     │ 公开：页面/脚本
│  (GitHub     │                          │ (GitHub Pages)   │
│   Pages)     │   写 phone/*.md（追加）   └─────────────────┘
│              │ ───────────────────────► ┌─────────────────┐
└──────────────┘                          │ dsh-memo-data    │ 私有：记忆包
        ▲                                  │  pack/  phone/   │
        │        每 1 小时 / 开机后 2 分钟   └─────────────────┘
        │                                          ▲
        │                                          │
   ┌────┴──────────────────────────────────────────┴────┐
   │ 电脑端：tools/memo.mjs sync                         │
   │ 读本地 AI 记忆 → 生成 pack → 推仓库 → 拉手机笔记    │
   └────────────────────────────────────────────────────┘
```

**为什么要两个仓？** App 要公开才能用 Pages 免费托管；记忆是私人的，必须放私有仓。

---

## 快速开始（约 10 分钟）

### 1. Fork / 新建 App 仓

- 新建一个**公开**仓库，把本仓库内容放进去（或直接 Fork）；
- Settings → Pages → Source 选 `main` / 根目录；
- 记下地址，形如 `https://你的用户名.github.io/仓库名/`。

### 2. 建私有数据仓

- 新建**私有**仓库，例如 `dsh-memo-data`，什么都不用放。

### 3. 建一个 Fine-grained PAT

GitHub → Settings → Developer settings → Personal access tokens → Fine-grained：

- **Repository access**：只选上面两个仓；
- **权限**：`Contents: Read and write`（数据仓必需）、`Pages: Read and write`（如果要脚本自动开 Pages）。

### 4. 配置并初始化

```bash
git clone https://github.com/你的用户名/仓库名.git
cd 仓库名
cp tools/config.example.json tools/config.json      # 填 repo / appRepo / workspace
echo "github_pat_xxx" > token.txt                   # 或设环境变量 MEMO_GH_TOKEN
node tools/setup.mjs                                # 校验仓库、上传页面、开 Pages、推一版记忆包
```

`workspace` 怎么填：电脑上打开 `~/.dsh/memory/workspaces/`，里面那个目录名就是（形如 `--C--Users-you--`）。

### 5. 手机安装

1. iPhone 用 **Safari** 打开 Pages 地址；
2. 分享 → **添加到主屏幕**；
3. 打开 App → 设置 → 填：API Key、数据仓 `用户名/仓库名`、分支 `main`、PAT、前缀 `pack`；
4. 保存并同步 → 看到「记忆 xx KB」就通了。

> 只有 Safari 的「添加到主屏幕」能全屏独立运行；Chrome / 微信内置浏览器加的还是带地址栏的网页。

---

## 同步怎么跑

| 方向 | 时机 |
|---|---|
| 手机 → 仓库 | 每轮回答后自动记一行；或手动「记进笔记」；离线时进队列 |
| 仓库 → 电脑 | 电脑端 `node tools/memo.mjs sync`（建议做成开机 + 每小时的计划任务） |
| 电脑 → 仓库 | 同一次 sync：重新生成记忆包并推回 |
| 仓库 → 手机 | App 启动时拉一次；也可在「记忆」页手动重新拉取 |

Windows 计划任务示例（登录后 2 分钟，之后每小时）：

```powershell
$act = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c 你的路径\run-sync.cmd"
$trg = New-ScheduledTaskTrigger -AtLogOn
$trg.Repetition = (New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Hours 1)).Repetition
Register-ScheduledTask -TaskName "dsh-memo-sync" -Action $act -Trigger $trg
```

---

## 记忆包里有什么

| 文件 | 内容 |
|---|---|
| `persona.md` | 人格设定 |
| `rules.md` | 硬性规则（必须遵守） |
| `style.md` | 风格与交付偏好 |
| `recent.md` | 最近 7 天做的事 |
| `digest.md` | 分层摘要（7 天 / 30 天要点） |
| `skills.md` | 已固化的技能清单 |
| `profile.md` | 可选的用户画像 |
| `durable.md` | 手机端记下的长期事实（回灌） |
| `meta.json` | 生成时间等元信息 |

---

## 安全

- **不要提交** `token.txt`、`tools/config.json`、`.memo-state.json`、`pack-out/`（`.gitignore` 已排除）；
- PAT 只给两个仓的最小权限；
- App 是纯静态页面，**API Key 与 PAT 只存在手机本地 localStorage**，不会上传；
- 数据仓务必设为 **Private**。

---

## 常见问题

**Q：手机上显示「渲染库没加载」？**
旧缓存。设置 → 强制更新（清缓存重载）。

**Q：公式整行变红？**
LaTeX 里 `%` 没转义（`%` 是注释符）。本项目已自动补 `\%`，仍失败就点设置里的「查看日志」上传给电脑排查。

**Q：回答中途断了？**
iOS 切后台会挂起网络。已生成的部分会保留，气泡下有「继续写 / 重试」。

**Q：能离线发消息吗？**
不能——模型在云端。离线只能看历史、看记忆、记笔记（笔记会排队补传）。

**Q：能跑桌面端 AI 的插件吗？**
不能直接跑（插件要 Node 宿主）。纯逻辑能力（搜索、表情、记忆、笑话）都已在 App 内重写。

---

## 目录

```
index.html            单文件 App（UI + 逻辑）
sw.js                 Service Worker（离线外壳）
manifest.webmanifest  PWA 清单
stickers.json         表情清单
vendor/               marked / DOMPurify / KaTeX / PDF.js（自托管，不依赖 CDN）
tools/
  memo.mjs            记忆包生成 / 拉取 / 推送
  setup.mjs           一键初始化（校验仓库、上传页面、开 Pages、首推）
  check.mjs           仓库连通性检查
  pushsrc.mjs         源码备份到数据仓
```

---

## 致谢

- 表情素材：B 站 **可以叫我云大人**（kiriyuki.com），遵循原作者授权条款，请勿用于商业用途；
- 渲染：marked、DOMPurify、KaTeX、PDF.js，均为各自开源许可。

## License

代码部分 MIT；`vendor/` 与表情素材遵循各自上游许可。
