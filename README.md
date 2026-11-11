# 米哈游游戏日历

原神 / 崩坏：星穹铁道 / 绝区零 / 星布谷地 四款游戏的版本与卡池时间线日历。

**在线访问**：<https://fatdragon743.github.io/mihoyo-calendar/>

## 功能

- **四游戏总览**：一张日历合并显示四款游戏的版本更新、卡池/跃迁/频段开启、前瞻直播、角色立绘 PV 与里程碑；每格按游戏分组，顶部色带标示在售状态
- **各游戏状态**：侧栏「各游戏在售 / 各游戏版本」一览四款游戏当前状态，点击行可跳到该游戏下一个重要事件
- **角色查询**：跨四游戏查询角色的全部 UP 记录与距今时间（含最近 UP 快捷入口），点击头像看立绘
- **未来提醒**：14/30/60 天窗口、按日期分组的事件列表 + 浏览器通知
- **规律预测**：按 6 周版本周期与 B 站官方发布节奏推算未来约一年的事件（前瞻 ≈ U-12、立绘 ≈ U-8、角色 PV ≈ U-7、演示 ≈ U-2 等），标有「预测」标记

## 本地使用

```bash
python update_data.py     # 从 biligame 各游戏 Wiki 抓取版本与卡池数据 → data/
python fetch_assets.py    # 下载角色头像/立绘 → data/avatars, data/portraits
python daily_digest.py --days 7          # 终端提醒摘要（支持 --game 过滤）
```

静态站点无构建步骤，直接打开 `index.html` 或部署到任意静态托管即可。

## 自动更新（GitHub Actions）

`.github/workflows/update-data.yml` 每天北京时间 **09:00**（UTC 01:00）自动运行一次：

1. 运行 `python update_data.py` 抓取四款游戏的最新版本与卡池数据
2. `.github/scripts/has_changes.py` 对比数据是否有**实质变化**（忽略 `generated` 时间戳与换行差异）
3. 有变化才提交到 `main`，并由 GitHub Pages 自动重建站点；没变化则跳过，不产生无意义 commit

也可以在仓库 **Actions → 自动更新游戏数据 → Run workflow** 手动触发。

> 提示：GitHub 会在仓库连续 60 天无提交活动后暂停定时任务，届时到 Actions 页面重新启用即可。

## 数据来源

- [原神 Wiki](https://wiki.biligame.com/ys/) · [星穹铁道 Wiki](https://wiki.biligame.com/sr/) · [绝区零 Wiki](https://wiki.biligame.com/zzz/)（版本时间与卡池阵容为真实资料）
- 米哈游官网公告接口（版本日期/主题校正，绝区零频段起止与限定代理人直接来自官方公告）
- 星布谷地为人工维护的里程碑（公测 2026-12-04）
- 角色头像/立绘来自各游戏 Wiki（命名规则：原神/星铁 `<角色>立绘.png`，绝区零 `角色立绘-<角色>.png`）
- 未来事件为规律推算，实际以米哈游官方公告为准
