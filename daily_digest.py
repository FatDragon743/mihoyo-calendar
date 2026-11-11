# -*- coding: utf-8 -*-
"""
米哈游游戏日历 · 未来提醒摘要生成器（多游戏版）
读取 data/games.json（由 update_data.py 生成），按各游戏规律推算事件，
输出未来 N 天的提醒文本，供 WorkBuddy 定时任务 / 微信推送脚本调用。

覆盖：原神 / 崩坏：星穹铁道 / 绝区零 / 星布谷地

用法：
    python daily_digest.py                 # 默认未来 7 天，四个游戏
    python daily_digest.py --days 14
    python daily_digest.py --days 7 --game genshin
    python daily_digest.py --days 7 --out remind.txt
"""
import argparse
import json
import re
import sys
from datetime import date, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE / 'data'
WEEK = ['一', '二', '三', '四', '五', '六', '日']
ORDER = ['genshin', 'starrail', 'zzz', 'planet']

DEFAULTS = {
    'VERSION_DAYS': 42, 'MINOR_MAX': 8, 'HALF2_OFFSET': 20,
    'LIVE_OFFSET': -12, 'LIVE_TIME': '', 'CODE_EXPIRE_DAYS': 3, 'CODE_EXPIRE_TIME': '12:00',
    'SPLASH_FIRST': -8, 'PV_LAST': -6, 'DEMO_LAST': -1, 'RERUN_FIRST': -3,
    'HAS_DEMO': False, 'RERUN_INTRO': False, 'MILESTONE_ONLY': False,
    'PHASE_WORD': '卡池', 'WEAPON_WORD': '武器池',
}


def d(s):
    y, m, dd = map(int, s.split('-'))
    return date(y, m, dd)


def f(dte):
    return dte.strftime('%Y-%m-%d')


def add(dte, n):
    return dte + timedelta(days=n)


# ---------------------------------------------------------------- 时间线
def build_timeline(g, R):
    data = [dict(v) for v in g.get('versions', [])]
    known = {v['version'] for v in data}
    for b in g.get('banners', []):
        if b['version'] not in known:
            data.append({'version': b['version'], 'major': False, 'start': b['start'],
                         'title': '', 'region': '', 'characters': '', 'from_banner': True})
            known.add(b['version'])
    data.sort(key=lambda o: o['start'])
    if not R['VERSION_DAYS']:
        return data

    last = data[-1]
    m = re.match(r'^(\d+)\.(\d+)$', last['version'])
    major, minor = (int(m.group(1)), int(m.group(2))) if m else (1, 0)
    max_minor = R['MINOR_MAX'] or 8
    cur = d(last['start'])
    for _ in range(9):
        minor += 1
        if minor > max_minor:
            major += 1
            minor = 0
        cur = add(cur, R['VERSION_DAYS'])
        data.append({'version': f'{major}.{minor}', 'major': minor == 0, 'start': f(cur),
                     'title': '（规律预测）' if minor else '新篇章（待官宣）',
                     'region': '', 'characters': '', 'predicted': True})
    return data


def first_seen(banners):
    seen = {}
    for b in sorted(banners, key=lambda x: x['start']):
        for cb in b.get('character', []):
            for n in cb.get('five', []):
                seen.setdefault(n, {'rarity': 5, 'version': b['version'], 'date': b['start']})
            for n in cb.get('four', []):
                seen.setdefault(n, {'rarity': 4, 'version': b['version'], 'date': b['start']})
    return seen


# ---------------------------------------------------------------- 事件
def build_events(g, timeline, R):
    banners = g.get('banners', [])
    fs = first_seen(banners)
    by_ver_new = {}
    for n, info in fs.items():
        by_ver_new.setdefault(info['version'], {'five': [], 'four': []})
        by_ver_new[info['version']]['five' if info['rarity'] == 5 else 'four'].append(n)

    by_phase = {b['phase']: b for b in banners}
    by_phase_list = list(banners)

    def half2_fallback(ver, start):
        """下半日期：优先按规律推算；若该版本已有真实卡池结束更晚，则顺延一天"""
        if R['HALF2_OFFSET'] is None:
            return ''
        fb = f(add(start, R['HALF2_OFFSET']))
        ends = [b['end'] for b in by_phase_list if b['version'] == ver and b.get('end')]
        if ends and max(ends) >= fb:
            fb = f(add(d(max(ends)), 1))
        return fb
    evts = []   # (date, priority, title)

    if R['MILESTONE_ONLY']:
        for m in g.get('milestones', []):
            evts.append((m['date'], 1 if m.get('type') == 'launch' else 4, m['title']))
    else:
        for v in timeline:
            ver, start = v['version'], d(v['start'])
            p1, p2 = by_phase.get(ver + '上半'), by_phase.get(ver + '下半')
            t = v.get('title') or ''
            tt = '' if (not t or t.startswith('（')) else f'「{t}」'
            evts.append((v['start'], 1, f'{ver} 版本更新{tt}'))

            for banner, fb, half in ((p1, v['start'], '上半'),
                                     (p2, half2_fallback(ver, start), '下半')):
                if banner:
                    names = ' ＋ '.join('/'.join(c.get('five', [])) for c in banner.get('character', []))
                    evts.append((banner['start'], 2, f"{ver}{half}{R['PHASE_WORD']} · {names}"))
                elif fb:
                    evts.append((fb, 2, f"{ver}{half}{R['PHASE_WORD']}开启（待官宣）"))

            for b in by_phase_list:
                if b['version'] == ver and b['half'] in ('中', '额外'):
                    names = ' ＋ '.join('/'.join(c.get('five', [])) for c in b.get('character', []))
                    evts.append((b['start'], 2, f"{ver}{'中期' if b['half'] == '中' else '额外'}"
                                               f"{R['PHASE_WORD']} · {names}"))

            if R['LIVE_OFFSET'] is not None:
                live = add(start, R['LIVE_OFFSET'])
                evts.append((f(live), 3, f"{ver} 前瞻特别节目 {R['LIVE_TIME']}".strip()))
                if R['CODE_EXPIRE_DAYS'] is not None:
                    evts.append((f(add(live, R['CODE_EXPIRE_DAYS'])), 6,
                                 f"{ver} 前瞻兑换码 {R['CODE_EXPIRE_TIME']} 过期"))

            new = by_ver_new.get(ver, {'five': [], 'four': []})

            def new_in(banner, rarity):
                if not banner:
                    return []
                src = new['five'] if rarity == 5 else new['four']
                out = []
                for cb in banner.get('character', []):
                    for n in (cb.get('five') if rarity == 5 else cb.get('four')) or []:
                        if n in src and n not in out:
                            out.append(n)
                return out

            p1_start = d(p1['start']) if p1 else start
            p1_five, p1_four = new_in(p1, 5), new_in(p1, 4)

            if R['SPLASH_FIRST'] is not None:
                for i, n in enumerate(p1_five + p1_four):
                    evts.append((f(add(p1_start, R['SPLASH_FIRST'] + i)), 4, f'{ver} 新角色立绘 · {n}'))
            if R['PV_LAST'] is not None:
                n5 = len(p1_five)
                for i, n in enumerate(p1_five):
                    off = R['PV_LAST'] - (n5 - 1 - i)
                    evts.append((f(add(p1_start, off)), 5, f'{ver}上半 角色PV · {n}'))
            if R['HAS_DEMO'] and R['DEMO_LAST'] is not None:
                demo = p1_four + p1_five
                for i, n in enumerate(demo):
                    off = R['DEMO_LAST'] - (len(demo) - 1 - i)
                    evts.append((f(add(p1_start, off)), 5, f'{ver}上半 角色演示 · {n}'))
            if R['RERUN_INTRO'] and p2 and R['RERUN_FIRST'] is not None:
                p2_start = d(p2['start'])
                p2_five = []
                for cb in p2.get('character', []):
                    for n in cb.get('five', []):
                        if n not in p2_five:
                            p2_five.append(n)
                for i, n in enumerate(p2_five):
                    evts.append((f(add(p2_start, R['RERUN_FIRST'] + i)), 4, f'{ver}下半 角色介绍 · {n}'))

    seen, out = set(), []
    for e in sorted(evts, key=lambda x: (x[0], x[1])):
        key = (e[0], e[2])
        if key in seen:
            continue
        seen.add(key)
        out.append(e)
    return out


# ---------------------------------------------------------------- 摘要
def game_section(g, days, today):
    R = dict(DEFAULTS, **(g.get('rules') or {}))
    timeline = build_timeline(g, R)
    evts = build_events(g, timeline, R)
    end = add(today, days)
    upcoming = [e for e in evts if today <= d(e[0]) <= end]

    # 当前版本 / 当前卡池
    cur_ver = None
    for v in timeline:
        if d(v['start']) <= today:
            cur_ver = v
        else:
            break
    cur_banner = next((b for b in sorted(g.get('banners', []), key=lambda x: x['start'])
                       if d(b['start']) <= today <= d(b['end'])), None)

    name = g['name']
    lines = []
    if R['MILESTONE_ONLY']:
        launch = next((m for m in g.get('milestones', []) if m.get('type') == 'launch'), None)
        if launch:
            left = (d(launch['date']) - today).days
            tail = f'距公测 {left} 天' if left > 0 else ('今天公测上线' if left == 0 else f'已公测 {-left} 天')
            lines.append(f'━━ {name}（{tail}）')
        else:
            lines.append(f'━━ {name}')
    elif cur_ver:
        day = (today - d(cur_ver['start'])).days + 1
        lines.append(f'━━ {name} {cur_ver["version"]}（第 {day}/{R["VERSION_DAYS"]} 天'
                     + (f'　{cur_ver["title"]}' if cur_ver.get('title') and not cur_ver['title'].startswith('（') else '')
                     + '）')
    else:
        lines.append(f'━━ {name}')

    if not upcoming:
        lines.append('· 未来 %d 天无事件' % days)
    for ds, _pri, title in upcoming:
        dd = (d(ds) - today).days
        tag = '今天' if dd == 0 else ('明天' if dd == 1 else f'{dd}天后')
        lines.append(f'· {tag} {ds[5:]}(周{WEEK[d(ds).weekday()]}) {title}')

    if cur_banner:
        five = '、'.join('/'.join(c.get('five', [])) for c in cur_banner.get('character', []))
        left = (d(cur_banner['end']) - today).days
        lines.append(f'　当前UP：{cur_banner["phase"]} {five}（剩 {left} 天）')
    return lines


def digest(days=7, only=None):
    payload = json.loads((DATA / 'games.json').read_text(encoding='utf-8'))
    games = {g['id']: g for g in payload['games']}
    today = date.today()

    lines = [f'【米哈游游戏日历】未来 {days} 天提醒（{today.strftime("%m-%d")}）']
    picked = [gid for gid in ORDER if gid in games and (not only or gid in only)]
    for gid in picked:
        lines.extend(game_section(games[gid], days, today))
    lines.append('（版本与卡池为 Wiki 真实资料；标「前瞻/立绘/PV」等按官方发布节奏推算，以官方公告为准）')
    return '\n'.join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--days', type=int, default=7)
    ap.add_argument('--game', action='append', default=[],
                    help='只看某个游戏：genshin / starrail / zzz / planet，可多次指定')
    ap.add_argument('--out', default='')
    a = ap.parse_args()
    text = digest(a.days, a.game or None)
    if a.out:
        Path(a.out).write_text(text, encoding='utf-8')
        print(f'已写入 {a.out}')
    print(text)


if __name__ == '__main__':
    sys.exit(main())
