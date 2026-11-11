# -*- coding: utf-8 -*-
"""
米哈游游戏日历 · 数据更新脚本（多游戏版）
从 bilibili 各游戏 Wiki 抓取版本与卡池/跃迁/调频数据，统一写成 data/games/<id>.json
再合并成 data/games.js 供静态页面读取（file:// 下不能 fetch JSON，故必须同时产出 js）。

支持游戏：
  genshin   原神        wiki.biligame.com/ys   「版本历史」+「往期祈愿」
  starrail  崩坏:星穹铁道 wiki.biligame.com/sr   「版本新增内容」+「跃迁/4.0|3.0|2.0|1.0」
  zzz       绝区零       wiki.biligame.com/zzz  「版本新增内容」+「往期调频」
  planet    星布谷地     官网里程碑（人工维护 data/games/planet.source.json）

用法：
    python update_data.py                # 更新全部游戏
    python update_data.py --game zzz     # 只更新绝区零
    python update_data.py --only-js      # 不联网，仅用现有 json 重新生成 data/games.js
"""
import argparse
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from collections import OrderedDict
from datetime import date, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE / 'data'
GDIR = DATA / 'games'
UA = 'Mozilla/5.0 MihoyoCalendar/2.0'
VER_CN = {'一': '1', '二': '2', '三': '3', '四': '4', '五': '5', '六': '6', '七': '7', '八': '8', '九': '9'}

# ---------------------------------------------------------------- 元信息
GAMES = OrderedDict([
    ('genshin', {
        'id': 'genshin', 'name': '原神', 'tagline': '提瓦特时间线', 'icon': '✦',
        'accent': '#c8a45c', 'wiki': 'ys',
        'rules': {
            'VERSION_DAYS': 42, 'MINOR_MAX': 8, 'HALF2_OFFSET': 20,
            'LIVE_OFFSET': -12, 'LIVE_TIME': '周五 20:00',
            'CODE_EXPIRE_DAYS': 3, 'CODE_EXPIRE_TIME': '12:00',
            'SPLASH_FIRST': -8, 'PV_LAST': -6, 'DEMO_LAST': -1, 'RERUN_FIRST': -3,
            'HAS_DEMO': True, 'RERUN_INTRO': True, 'CALIBRATED': True,
            'PHASE_WORD': '卡池', 'WEAPON_WORD': '武器池',
            'CYCLE_NOTE': '6 周一个版本，周三更新；下半卡池 = 上半开启后 20 天 18:00',
            'CODE_NOTE': '官方口径为前瞻后 3 天 12:00 失效（不是当晚 23:59）',
        },
        'sources': [
            {'label': '原神Wiki·版本历史', 'url': 'https://wiki.biligame.com/ys/版本历史'},
            {'label': '原神Wiki·往期祈愿', 'url': 'https://wiki.biligame.com/ys/往期祈愿'},
            {'label': 'B站原神官方空间', 'url': 'https://space.bilibili.com/401742377/dynamic'},
        ],
    }),
    ('starrail', {
        'id': 'starrail', 'name': '崩坏：星穹铁道', 'short': '星铁', 'tagline': '开拓者时间线', 'icon': '✧',
        'accent': '#7a6ff0', 'wiki': 'sr',
        'rules': {
            'VERSION_DAYS': 42, 'MINOR_MAX': 8, 'HALF2_OFFSET': 21,
            'LIVE_OFFSET': -12, 'LIVE_TIME': '周五 19:30',
            'CODE_EXPIRE_DAYS': 1, 'CODE_EXPIRE_TIME': '23:59',
            'SPLASH_FIRST': -8, 'PV_LAST': -1, 'DEMO_LAST': None, 'RERUN_FIRST': None,
            'HAS_DEMO': False, 'RERUN_INTRO': False, 'CALIBRATED': False,
            'PHASE_WORD': '跃迁', 'WEAPON_WORD': '光锥',
            'CYCLE_NOTE': '6 周一个版本，周三更新；上下半卡池切换日为下半首池开启日（实测 U+17~U+23 浮动）',
            'CODE_NOTE': '前瞻直播兑换码一般在次日 23:59 失效，以直播提示为准',
        },
        'sources': [
            {'label': '星铁Wiki·版本新增内容', 'url': 'https://wiki.biligame.com/sr/版本新增内容'},
            {'label': '星铁Wiki·历史跃迁', 'url': 'https://wiki.biligame.com/sr/历史跃迁'},
            {'label': 'B站星穹铁道官方空间', 'url': 'https://space.bilibili.com/1340190821/dynamic'},
        ],
    }),
    ('zzz', {
        'id': 'zzz', 'name': '绝区零', 'tagline': '新艾利都时间线', 'icon': '◆',
        'accent': '#e8a33d', 'wiki': 'zzz',
        'rules': {
            'VERSION_DAYS': 42, 'MINOR_MAX': 8, 'HALF2_OFFSET': 20,
            'LIVE_OFFSET': -12, 'LIVE_TIME': '周五 19:00',
            'CODE_EXPIRE_DAYS': 1, 'CODE_EXPIRE_TIME': '23:59',
            'SPLASH_FIRST': -8, 'PV_LAST': -3, 'DEMO_LAST': None, 'RERUN_FIRST': None,
            'HAS_DEMO': False, 'RERUN_INTRO': False, 'CALIBRATED': False,
            'PHASE_WORD': '频段', 'WEAPON_WORD': '音擎',
            'CYCLE_NOTE': '6 周一个版本，周三更新；下半频段约在上半开启后 20 天切换',
            'CODE_NOTE': '前瞻直播兑换码一般在次日 23:59 失效，以直播提示为准',
        },
        'sources': [
            {'label': '绝区零官网·新闻中心（主数据源，官方公告接口）', 'url': 'https://zzz.mihoyo.com/news'},
            {'label': '绝区零Wiki·版本新增内容', 'url': 'https://wiki.biligame.com/zzz/版本新增内容'},
            {'label': '绝区零Wiki·往期调频', 'url': 'https://wiki.biligame.com/zzz/往期调频'},
        ],
    }),
    ('planet', {
        'id': 'planet', 'name': '星布谷地', 'tagline': '公测倒计时 · 星球生活模拟', 'icon': '❋',
        'accent': '#4fa98a', 'wiki': None,
        'rules': {
            'VERSION_DAYS': None, 'MINOR_MAX': 8, 'HALF2_OFFSET': None,
            'LIVE_OFFSET': None, 'LIVE_TIME': '',
            'CODE_EXPIRE_DAYS': None, 'CODE_EXPIRE_TIME': '',
            'SPLASH_FIRST': None, 'PV_LAST': None, 'DEMO_LAST': None, 'RERUN_FIRST': None,
            'HAS_DEMO': False, 'RERUN_INTRO': False, 'CALIBRATED': False,
            'PHASE_WORD': '卡池', 'WEAPON_WORD': '武器池',
            'MILESTONE_ONLY': True,
            'CYCLE_NOTE': '尚未公测（2026-12-04 上线），官方未公布版本周期，暂不推算版本',
            'CODE_NOTE': '公测兑换码需在游戏内兑换，有效期以官方公告为准',
        },
        'sources': [
            {'label': '星布谷地官网', 'url': 'https://planet.mihoyo.com/'},
        ],
    }),
])


# ---------------------------------------------------------------- 官方公告接口
# 米哈游官网「新闻中心」用的统一内容接口：act-api-takumi-static.mihoyo.com/content_v2_user/app/<appId>/getContentList
# 返回结构化 JSON（标题 / 发布时间 / 正文 HTML），无需登录、签名或 cookie，比 B 站动态稳定得多。
OFFICIAL = {
    'genshin': {'app': '16471662a82d418a', 'notice': 721, 'news': 719,
                'ref': 'https://ys.mihoyo.com/'},
    'starrail': {'app': '1963de8dc19e461c', 'notice': 257, 'news': 255,
                 'ref': 'https://sr.mihoyo.com/'},
    'zzz': {'app': '706fd13a87294881', 'notice': 279, 'news': 278,
            'ref': 'https://zzz.mihoyo.com/'},
}
OFFICIAL_HOST = 'https://act-api-takumi-static.mihoyo.com/content_v2_user/app'


def official_list(gid: str, channel: str = 'notice', pages: int = 1,
                  size: int = 40, retries: int = 3):
    """拉取官网公告/新闻列表。channel: 'notice'(公告) / 'news'(新闻)。"""
    conf = OFFICIAL.get(gid)
    if not conf:
        return []
    chan = conf[channel]
    out = []
    for page in range(1, pages + 1):
        url = (f"{OFFICIAL_HOST}/{conf['app']}/getContentList"
               f'?iChanId={chan}&iPageSize={size}&iPage={page}&sLangKey=zh-cn')
        last = None
        for i in range(retries):
            try:
                req = urllib.request.Request(url, headers={'User-Agent': UA,
                                                           'Referer': conf['ref']})
                with urllib.request.urlopen(req, timeout=25) as r:
                    d = json.loads(r.read().decode('utf-8'))
                out.extend((d.get('data') or {}).get('list') or [])
                last = None
                break
            except Exception as e:
                last = e
                time.sleep(1.5 * (i + 1))
        if last:
            if not out:
                raise last
            break
        time.sleep(0.3)
    return out


def html_text(html: str) -> str:
    """公告正文 HTML → 纯文本（保留段落换行）。"""
    s = re.sub(r'<br\s*/?>', '\n', html or '', flags=re.I)
    s = re.sub(r'</(p|div|li|tr)>', '\n', s, flags=re.I)
    s = re.sub(r'<[^>]+>', '', s)
    s = (s.replace('&nbsp;', ' ').replace('&amp;', '&')
          .replace('&lt;', '<').replace('&gt;', '>').replace('&quot;', '"'))
    return re.sub(r'[ \t]+', ' ', s)


# 各游戏的「版本更新」公告标题写法不同，这里统一抽出 版本号 + 版本主题 + 更新日
UPDATE_TITLE = {
    'genshin': re.compile(r'「?([^」]{0,40})」?(月之[一二三四五六七八九]|\d+\.\d+)版本更新说明'),
    'starrail': re.compile(r'(\d+\.\d+)版本「([^」]+)」版本更新说明'),
    'zzz': re.compile(r'(\d+\.\d+)版本「([^」]+)」(?:更新公告|更新说明)'),
}


def official_versions(gid: str, pages: int = 2) -> dict:
    """官网「版本更新说明/更新公告」→ {版本号: {start, title}}，用于校正 Wiki 日期与主题。"""
    pat = UPDATE_TITLE.get(gid)
    if not pat:
        return {}
    out = {}
    try:
        items = official_list(gid, 'notice', pages=pages)
    except Exception as e:
        print(f'  · 官方公告接口不可用（{type(e).__name__}），跳过校正')
        return {}
    for it in items:
        title = (it.get('sTitle') or '').strip()
        m = pat.search(title)
        if not m:
            continue
        if gid == 'genshin':
            name, ver = m.group(1), m.group(2)
        else:
            ver, name = m.group(1), m.group(2)
        day = (it.get('dtStartTime') or '')[:10]
        if not ver or not re.match(r'^\d{4}-\d{2}-\d{2}$', day):
            continue
        out[ver] = {'start': day, 'title': clean(name)}
    return out


# ---------------------------------------------------------------- 网络
def wt(wiki: str, page: str, retries: int = 3) -> str:
    url = (f'https://wiki.biligame.com/{wiki}/api.php?action=parse&prop=wikitext'
           '&format=json&page=' + urllib.parse.quote(page))
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA,
                                                       'Referer': f'https://wiki.biligame.com/{wiki}/'})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode('utf-8'))['parse']['wikitext']['*']
        except Exception as e:
            last = e
            time.sleep(1.5 * (i + 1))
    raise last


def clean(s: str) -> str:
    if not s:
        return ''
    s = re.sub(r'<!--.*?-->', '', s, flags=re.S)
    s = re.sub(r'\[\[文件:[^]]*\]\]', '', s)
    s = re.sub(r'\[\[(?:[^]|]*\|)?([^]]*)\]\]', r'\1', s)
    s = re.sub(r'<small>.*?</small>', '', s, flags=re.S)
    s = re.sub(r'<br\s*/?>', '、', s)
    s = re.sub(r'<[^>]+>', '', s)
    s = re.sub(r"''+", '', s)
    return re.sub(r'\s+', ' ', s).strip(' 、,|')


def split_list(s: str):
    return [x.strip() for x in re.split(r'[、,，]', clean(s)) if x.strip()]


def day_pair(s: str):
    """'2026/11/11 10:00' -> ('2026-11-11', '10:00')"""
    m = re.match(r'(\d{4})/(\d{1,2})/(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?', (s or '').strip())
    if not m:
        return None, ''
    y, mo, d, hh, mi = m.groups()
    return f'{y}-{int(mo):02d}-{int(d):02d}', (f'{int(hh):02d}:{mi}' if hh else '')


def add_days(s: str, n: int) -> str:
    y, m, d = map(int, s.split('-'))
    return (date(y, m, d) + timedelta(days=n)).strftime('%Y-%m-%d')


# ---------------------------------------------------------------- 原神
def genshin_versions():
    text = wt('ys', '版本历史')
    rows = []
    for m in re.finditer(r'\{\{版本历史\|([^}]+)\}\}', text):
        fs = {}
        for part in m.group(1).split('|'):
            if '=' in part:
                k, v = part.split('=', 1)
                fs[k.strip()] = v.strip()
        v = fs.get('版本数', '')
        if not (re.match(r'^[\d.]+$', v) or re.match(r'^月之[一二三四五六七八九]$', v)):
            continue
        t = (fs.get('更新时间') or '').strip()
        if not re.match(r'^\d{4}/\d{2}/\d{2}$', t):
            continue
        rows.append({
            'version': v,
            'major': fs.get('大版本') == '是',
            'start': t.replace('/', '-'),
            'title': clean(fs.get('版本标题', '')),
            'characters': clean(fs.get('角色', '')),
            'region': clean(fs.get('新增地区', '')),
        })
    rows.sort(key=lambda o: o['start'])
    if rows and rows[0]['version'] != '1.0':
        rows.insert(0, {'version': '1.0', 'major': True, 'start': '2020-09-28',
                        'title': '异乡人的序章', 'characters': '温迪、可莉', 'region': '蒙德、璃月'})
    return rows


def genshin_banners():
    text = wt('ys', '往期祈愿')

    def tmpls(kind):
        out = []
        for m in re.finditer(r'\{\{祈愿/' + kind + r'\s*\|(.*?)\}\}', text, re.S):
            fs = {}
            for part in re.sub(r'<!--.*?-->', '', m.group(1), flags=re.S).split('|'):
                if '=' in part:
                    k, v = part.split('=', 1)
                    fs[k.strip()] = v.strip()
            out.append(fs)
        return out

    phases = OrderedDict()
    for c in tmpls('角色活动祈愿'):
        ph = (c.get('版本') or '').strip()
        start, stime = day_pair(c.get('开始时间'))
        if not ph or not start:
            continue
        end, _ = day_pair(c.get('结束时间'))
        p = phases.setdefault(ph, {'phase': ph, 'start': start, 'end': end,
                                   'startTime': stime, 'character': [], 'weapon': None})
        p['character'].append({'name': c.get('名称', ''),
                               'five': split_list(c.get('5星角色')),
                               'four': split_list(c.get('4星角色'))})
    for w in tmpls('武器活动祈愿'):
        ph = (w.get('版本') or '').strip()
        if ph in phases:
            phases[ph]['weapon'] = {'five': split_list(w.get('5星武器')),
                                    'four': split_list(w.get('4星武器'))}
    return finalize_banners(phases)


# ---------------------------------------------------------------- 星铁
def sr_versions():
    text = wt('sr', '版本新增内容')
    rows = []
    for m in re.finditer(r'\{\{版本内容\|([^}]*)\}\}', text):
        fs = dict(p.split('=', 1) for p in m.group(1).split('|') if '=' in p)
        ver = fs.get('版本数', '').strip()
        upd, _ = day_pair(fs.get('更新时间', ''))
        if not ver or not upd:
            continue
        rows.append({'version': ver, 'major': ver.endswith('.0'), 'start': upd,
                     'title': clean(fs.get('版本标题', '')),
                     'region': clean(fs.get('场景', ''))[:60],
                     'characters': ''})
    rows.sort(key=lambda o: o['start'])
    return rows


def sr_banners():
    phases = OrderedDict()
    for page in ('跃迁/4.0', '跃迁/3.0', '跃迁/2.0', '跃迁/1.0'):
        text = wt('sr', page)
        for kind in ('角色活动跃迁', '光锥活动跃迁'):
            for m in re.finditer(r'\{\{跃迁/' + kind + r'\s*\|(.*?)\}\}', text, re.S):
                body = re.sub(r'<!--.*?-->', '', m.group(1), flags=re.S)
                fs = {}
                for part in body.split('|'):
                    if '=' in part:
                        k, v = part.split('=', 1)
                        fs[k.strip()] = v.strip()
                ver, num = fs.get('版本', ''), fs.get('编号', '')
                start, stime = day_pair(fs.get('开始时间'))
                if not ver or not num or not start:
                    continue
                end, _ = day_pair(fs.get('结束时间'))
                key = f'{ver}·{num}'
                p = phases.setdefault(key, {'phase': '', 'version': ver, 'num': num,
                                            'start': start, 'end': end, 'startTime': stime,
                                            'character': [], 'weapon': None})
                if start < p['start']:
                    p['start'], p['startTime'] = start, stime
                cands = [x for x in (p['end'], end) if x]
                p['end'] = max(cands) if cands else p['start']
                if kind == '角色活动跃迁':
                    p['character'].append({'name': fs.get('名称') or '角色活动跃迁',
                                           'five': split_list(fs.get('5星角色', '')),
                                           'four': split_list(fs.get('4星角色', ''))})
                elif p['weapon'] is None:
                    p['weapon'] = {'five': split_list(fs.get('5星光锥', '')),
                                   'four': split_list(fs.get('4星光锥', ''))}
        time.sleep(0.4)
    return finalize_banners(phases, num_key=True)


# ---------------------------------------------------------------- 绝区零
def zzz_versions():
    text = wt('zzz', '版本新增内容')
    lines = text.splitlines()
    rows = []
    for i, ln in enumerate(lines):
        m = re.match(r'^\|\s*(\d+\.\d+)\s*$', ln.strip())
        if not m:
            continue
        block = []
        for l2 in lines[i + 1:i + 16]:
            if l2.strip().startswith('|-') or l2.strip().startswith('|}'):
                break
            block.append(l2)
        body = '\n'.join(block)
        dm = re.search(r'(\d{4})/(\d{1,2})/(\d{1,2})', body)
        if not dm:
            continue
        ver = m.group(1)
        date = f'{dm.group(1)}-{int(dm.group(2)):02d}-{int(dm.group(3)):02d}'
        title = ''
        for l2 in block:
            s = l2.strip()
            if re.search(r'\d{4}/\d{1,2}/\d{1,2}', s) or not s.startswith('|'):
                continue
            cand = clean(s[1:])
            if cand and '城区' not in cand and '[[' not in s:
                title = cand
                break
        agents = [a for a in re.findall(r'\[\[([^\]|]+)', body) if not a.startswith('文件')]
        region = ''
        for l2 in block:
            if '城区' in l2 or '[空洞]' in l2 or '[管制区]' in l2:
                region = clean(l2.strip().lstrip('|'))[:60]
                break
        rows.append({'version': ver, 'major': ver.endswith('.0'), 'start': date,
                     'title': title, 'region': region,
                     'characters': '、'.join(agents)})
    rows.sort(key=lambda o: o['start'])
    return rows


# ---------------------------------------------------------------- 统一收尾
# 调频「编号」→ 上下半：Wiki 里 0/1 都可能是上半（同一半有两个频段），2 为下半
HALF_NAME = {'0': '上半', '1': '上半', '2': '下半', '3': '额外'}


def _fix_year(day: str, ref: str) -> str:
    """Wiki 偶发把年份写错（如 3.1 上期写成 2025/07/29），用版本起始日校正。"""
    if not day or not ref:
        return day
    for _ in range(2):
        if day >= add_days(ref, -210):
            break
        day = str(int(day[:4]) + 1) + day[4:]
    return day


def zzz_wiki_phases(versions: list):
    """Wiki「往期调频」→ {期次: phase dict}。同一版本同一下半的多条频段合并。"""
    text = wt('zzz', '往期调频')
    ref = {v['version']: v['start'] for v in versions}

    def tmpls(kind):
        out = []
        for m in re.finditer(r'\{\{调频/' + kind + r'\s*\|(.*?)\}\}', text, re.S):
            body = re.sub(r'<!--.*?-->', '', m.group(1), flags=re.S)
            fs = {}
            for part in body.split('|'):
                if '=' in part:
                    k, v = part.split('=', 1)
                    fs[k.strip()] = v.strip()
            out.append(fs)
        return out

    phases = OrderedDict()
    for kind in ('独家频段', '音擎频段'):
        for fs in tmpls(kind):
            ver, num = fs.get('版本', ''), fs.get('编号', '')
            start, stime = day_pair(fs.get('开始时间'))
            end, _ = day_pair(fs.get('结束时间'))
            if not ver or not start:
                continue
            start = _fix_year(start, ref.get(ver))
            end = _fix_year(end, ref.get(ver))
            half = HALF_NAME.get(num, '上半')
            key = f'{ver}{half}'
            p = phases.setdefault(key, {'phase': key, 'start': start, 'end': end,
                                        'startTime': stime, 'character': [], 'weapon': None})
            if start < p['start']:
                p['start'], p['startTime'] = start, stime
            cands = [x for x in (p['end'], end) if x]
            p['end'] = max(cands) if cands else p['start']
            if kind == '独家频段':
                p['character'].append({'name': fs.get('名称') or '独家频段',
                                       'five': split_list(fs.get('S级代理人', '')),
                                       'four': split_list(fs.get('A级代理人', ''))})
            elif p['weapon'] is None:
                p['weapon'] = {'five': split_list(fs.get('S级音擎', '')), 'four': []}
    return phases


def zzz_official_phases(pages: int = 3):
    """官网「N.N版本限时频段（上期/下期）」公告 → {期次: phase dict}。

    Wiki 的「往期调频」要等编辑补录（下半常滞后几天、历史条目还有年份笔误），
    而官方在每半开池前 2 天就会发公告，正文直接写明时间与限定 S 级代理人/音擎。
    """
    try:
        items = official_list('zzz', 'notice', pages=pages)
    except Exception as e:
        print(f'  · 绝区零官方频段公告不可用（{type(e).__name__}），仅用 Wiki 数据')
        return {}
    out = OrderedDict()
    for it in items:
        title = (it.get('sTitle') or '').strip()
        m = re.match(r'^(\d+\.\d+)版本限时频段（([上下])期）$', title)
        if not m:
            continue
        ver, half = m.group(1), m.group(2) + '半'
        body = html_text(it.get('sContent') or '')
        rng = re.search(r'(\d{4}/\d{1,2}/\d{1,2})\s+\d{1,2}:\d{2}\s*[~～\-－]\s*'
                        r'(\d{4}/\d{1,2}/\d{1,2})\s+\d{1,2}:\d{2}', body)
        if not rng:
            rng = re.search(r'(\d{4}/\d{1,2}/\d{1,2})\s*[~～\-－]\s*(\d{4}/\d{1,2}/\d{1,2})', body)
        start, stime = day_pair(rng.group(1)) if rng else (None, '')
        end, _ = day_pair(rng.group(2)) if rng else (None, '')
        if not start:
            continue

        def names(kw):
            mm = re.search(kw + r'\s*(.+?)(?:的)?调频获取概率', body, re.S)
            if not mm:
                return []
            # 「[赛维里安(风·强攻)]、[诺姆(火·击破)]」→ 赛维里安 / 诺姆
            return [x.strip() for x in re.findall(r'[\[【]?([^\[\]【】、()（）\n]+?)\s*[(（]', mm.group(1))]

        agents = names(r'限定S级代理人')
        engines = names(r'限定S级音擎')
        chars = [{'name': a, 'five': [a], 'four': []} for a in agents] or \
                [{'name': f'{ver}{half}', 'five': [], 'four': []}]
        out[f'{ver}{half}'] = {'phase': f'{ver}{half}', 'start': start, 'end': end or start,
                               'startTime': stime, 'character': chars,
                               'weapon': {'five': engines, 'four': []} if engines else None}
    return out


def zzz_banners(versions: list):
    """Wiki 打底 + 官方公告校准：官方给出准确的期次起止与限定 S 级，Wiki 补频段名与 4 星。"""
    phases = zzz_wiki_phases(versions)
    for key, o in zzz_official_phases().items():
        p = phases.get(key)
        if not p:
            phases[key] = o
            continue
        p['start'], p['startTime'], p['end'] = o['start'], o['startTime'], o['end']
        if not any(c['five'] for c in p['character']) and any(c['five'] for c in o['character']):
            p['character'] = o['character']
        if not p.get('weapon') and o.get('weapon'):
            p['weapon'] = o['weapon']
    return finalize_banners(phases)


# Wiki「版本新增内容」表格偶有滞后（新版本已上线但表格未补），这里按官网公告补录
TITLE_PATCH = {
    'zzz': {'3.3': '重返天空的旅程'},
    'starrail': {},
    'genshin': {},
}


def apply_patch(gid: str, versions: list):
    patch = TITLE_PATCH.get(gid) or {}
    for v in versions:
        if not v.get('title') and patch.get(v['version']):
            v['title'] = patch[v['version']]


def finalize_banners(phases: dict, num_key: bool = False):
    """按版本聚合、排序、裁剪交叠的结束时间，输出统一 banner 结构。"""
    out = []
    for key, p in phases.items():
        if num_key:
            half = HALF_NAME.get(p['num'], '上半')
            p['phase'] = f"{p['version']}{half}"
        else:
            ph = p['phase']
            half = '下半' if ph.endswith('下半') else ('中' if ph.endswith('中') else '上半')
        p['half'] = half
        p['version'] = re.sub(r'(上半|下半|中)$', '', p['phase'])
        out.append({k: p.get(k) for k in ('phase', 'version', 'half', 'start', 'end',
                                          'startTime', 'character', 'weapon')})
    out.sort(key=lambda o: (o['start'], o['phase']))

    # 同一版本内，前一期结束时间不得晚于后一期开始；跨版本同理
    for i in range(len(out) - 1):
        nxt = out[i + 1]['start']
        if out[i]['end'] and out[i]['end'] >= nxt:
            out[i]['end'] = add_days(nxt, -1)
    return out


# ---------------------------------------------------------------- 组装
def collect(gid: str):
    meta = dict(GAMES[gid])
    if gid == 'genshin':
        versions, banners = genshin_versions(), genshin_banners()
    elif gid == 'starrail':
        versions, banners = sr_versions(), sr_banners()
    elif gid == 'zzz':
        versions = zzz_versions()
        banners = zzz_banners(versions)
    elif gid == 'planet':
        src = json.loads((GDIR / 'planet.source.json').read_text(encoding='utf-8'))
        versions, banners = [], []
        meta['milestones'] = src['milestones']
    else:
        raise SystemExit(f'未知游戏 {gid}')

    # 官方「版本更新说明」校正版本日期与主题（Wiki 偶有笔误/滞后）
    off = official_versions(gid)
    if off:
        fixed = 0
        for v in versions:
            o = off.get(v['version'])
            if not o:
                continue
            if o['start'] != v['start']:
                fixed += 1
                v['start'] = o['start']
                v['startSource'] = 'official'
            if o.get('title') and o['title'] != v.get('title'):
                v['title'] = o['title']
        if fixed:
            print(f'  · 官方公告校正了 {fixed} 个版本日期')
        versions.sort(key=lambda o: o['start'])

    # 版本表滞后于卡池数据时补版本
    known = {v['version'] for v in versions}
    for b in banners:
        if b['version'] not in known:
            versions.append({'version': b['version'], 'major': b['version'].endswith('.0'),
                             'start': b['start'], 'title': '', 'region': '',
                             'characters': '', 'fromBanner': True})
            known.add(b['version'])
    versions.sort(key=lambda o: o['start'])
    apply_patch(gid, versions)

    # 星布谷地：把公测日当作「上线」节点，方便日历高亮
    if gid == 'planet':
        launch = next((m for m in meta['milestones'] if m['type'] == 'launch'), None)
        if launch:
            versions = [{'version': '公测', 'major': True, 'start': launch['date'],
                         'title': '星布谷地', 'region': '', 'characters': '',
                         'launch': True}]

    meta['versions'] = versions
    meta['banners'] = banners
    meta.setdefault('milestones', [])
    meta['generated'] = time.strftime('%Y-%m-%d %H:%M')
    return meta


def write_outputs(games: list):
    GDIR.mkdir(parents=True, exist_ok=True)
    for g in games:
        (GDIR / f"{g['id']}.json").write_text(
            json.dumps(g, ensure_ascii=False, indent=1), encoding='utf-8')
    payload = {'generated': time.strftime('%Y-%m-%d %H:%M'), 'games': games}
    (DATA / 'games.json').write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding='utf-8')
    (DATA / 'games.js').write_text(
        '// 由 update_data.py 生成，来源：各游戏 bilibili Wiki + 官方公告\n'
        'const GAMES_DATA = ' + json.dumps(payload, ensure_ascii=False, indent=1) + ';\n',
        encoding='utf-8')


def legacy_genshin(g):
    """兼容旧文件：data/versions.json、data/banners.json 及对应 js"""
    ver = [{k: v.get(k, '') for k in ('version', 'major', 'start', 'title', 'characters', 'region')}
           for v in g['versions']]
    (DATA / 'versions.json').write_text(json.dumps(ver, ensure_ascii=False, indent=1), encoding='utf-8')
    (DATA / 'banners.json').write_text(json.dumps(g['banners'], ensure_ascii=False, indent=1), encoding='utf-8')
    (DATA / 'versions.js').write_text(
        '// 由 update_data.py 生成，来源：bilibili 原神Wiki「版本历史」\nconst VERSION_DATA = '
        + json.dumps(ver, ensure_ascii=False, indent=1) + ';\n', encoding='utf-8')
    (DATA / 'banners.js').write_text(
        '// 由 update_data.py 生成，来源：bilibili 原神Wiki「往期祈愿」\nconst BANNER_DATA = '
        + json.dumps(g['banners'], ensure_ascii=False, indent=1) + ';\n', encoding='utf-8')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--game', action='append', default=[], help='只更新指定游戏，可多次指定')
    ap.add_argument('--only-js', action='store_true', help='不联网，仅用现有 json 重建 games.js')
    a = ap.parse_args()

    DATA.mkdir(exist_ok=True)
    targets = a.game or list(GAMES)
    errors = []

    if a.only_js:
        games = []
        for gid in GAMES:
            f = GDIR / f'{gid}.json'
            if f.exists():
                games.append(json.loads(f.read_text(encoding='utf-8')))
        if not games:
            sys.exit('data/games/ 下没有可用的 json，请先联网运行一次')
        write_outputs(games)
        print(f'已写入 data/games.js（{len(games)} 个游戏）')
        return

    games = []
    for gid in GAMES:
        f = GDIR / f'{gid}.json'
        old = json.loads(f.read_text(encoding='utf-8')) if f.exists() else None
        if gid not in targets and old:
            games.append(old)
            continue
        print(f'· 抓取 {GAMES[gid]["name"]} …')
        try:
            g = collect(gid)
        except Exception as e:
            print(f'  ✗ 失败：{type(e).__name__} {e}')
            errors.append(gid)
            if old:
                print('  · 保留上一次的数据')
                games.append(old)
            continue
        v = len(g['versions'])
        b = len(g['banners'])
        print(f'  ✓ 版本 {v} 个，卡池/跃迁/频段 {b} 期，最新 '
              f'{g["versions"][-1]["version"] if v else "—"}'
              f'（{g["versions"][-1]["start"] if v else "—"}）')
        if gid == 'genshin':
            legacy_genshin(g)
        games.append(g)

    write_outputs(games)
    print(f'已写入 data/games.json + data/games.js（{len(games)} 个游戏）')
    if errors:
        print('部分游戏更新失败：' + '、'.join(errors))
        sys.exit(1)
    print('刷新浏览器即可看到最新日历。')


if __name__ == '__main__':
    main()
