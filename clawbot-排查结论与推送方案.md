# 关于「clawbot」的排查结论与微信推送方案

> 2026-10-29 · 由 Claw 会话排查确认

## 背景

- 项目里已有 `daily_digest.py`，可生成未来 N 天的原神事件提醒摘要，注释里写着「供 WorkBuddy 定时任务 / 微信推送脚本调用」。
- 接入微信推送时，曾按用户说法寻找本机安装的「微信 clawbot」，但全盘未找到痕迹，一度卡住。

## 结论一：clawbot = WorkBuddy 的 Claw 通道，本机无独立安装

用户当前就是「微信 + Claw 通道」在与助手对话，所谓 clawbot 即这条桥。关键事实：

1. **Claw 通道是 WorkBuddy Desktop 内置能力，消息转发发生在 WorkBuddy 服务层**；
2. 本机不需要、也不存在名为 clawbot 的独立程序（已验证：无进程 / 服务 / npm 全局包 / 配置目录（`~/.clawbot`、`~/.openclaw` 等）/ Program Files / 开始菜单条目）；
3. 因此在本机文件系统里搜「clawbot」**永远搜不到，这是正常现象**，不代表没在用。

类比：用网页版微信聊天时，去 C 盘搜「微信客户端」当然搜不到——你用的东西不在那里。

## 结论二：微信推送不需要接任何本地接口

推送到微信的正确姿势：

> 建一个 WorkBuddy 定时自动化 → 每天运行 `daily_digest.py` → 把脚本 stdout 作为自动化汇报文本发出 → 文本经 Claw 通道自动送达用户的微信。

**不要**尝试寻找或调用本地 clawbot 的 CLI / HTTP / 配置接口（不存在）。

## daily_digest.py 用法备忘

```bash
# 默认未来 7 天，输出到 stdout
python daily_digest.py

# 未来 14 天，同时写入文件
python daily_digest.py --days 14 --out remind.txt
```

依赖 `data/versions.json` 与 `data/banners.json`（由 `update_data.py` 更新）。

## 建议的自动化配置（待建）

| 项 | 值 |
|---|---|
| 名称 | 原神日历每日提醒 |
| 频率 | 每天 1 次（时间待用户确认） |
| 工作目录 | `D:\workBuddyProject\原神日历` |
| 动作 | 运行 `python daily_digest.py --days 7`，将输出原文作为汇报发送 |
| 汇报要求 | 直接输出摘要文本即可，无需额外解释 |


## 2026-11-11 更新：日历扩展为米哈游多游戏

- `daily_digest.py` 现在覆盖 4 个游戏：原神 / 崩坏：星穹铁道 / 绝区零 / 星布谷地，
  输出标题从「【原神日历】」改为「【米哈游游戏日历】」，每个游戏一个小节（`━━ 游戏名 版本（第 x/42 天）`）。
- 自动化「原神日历每日提醒」无需改动：仍然运行 `python daily_digest.py --days 7` 并把 stdout 原文发出，
  只是正文变为多游戏版本；如只想要原神，可加参数 `--game genshin`。
- 数据来源：`update_data.py` 抓取 biligame 各游戏 Wiki（ys=原神、sr=星铁、zzz=绝区零），
  星布谷地为人工维护的里程碑（`data/games/planet.source.json`，公测 2026-12-04）。
- 页面 `index.html` 顶部新增游戏切换标签，支持 `?game=zzz` 直达；数据统一在 `data/games.js`。
