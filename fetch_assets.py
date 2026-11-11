# -*- coding: utf-8 -*-
"""
角色头像 / 立绘下载脚本（多游戏版）
按各游戏 Wiki 的文件命名规则抓取卡池中出现过的角色图片，生成 data/assets.js。

  genshin   原神       File:<角色>.png / File:<角色>立绘.png
  starrail  星铁       File:<角色>.png / File:<角色>立绘.png
  zzz       绝区零     File:角色头像-<角色>.png / File:角色立绘-<角色>.png
  星布谷地 Wiki 暂无角色图，页面退化成首字色块占位。

用法：
    python fetch_assets.py                 # 只下载缺失的
    python fetch_assets.py --game starrail  # 只补某个游戏
    python fetch_assets.py --force          # 全部重新下载
"""
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE / 'data'
UA = 'Mozilla/5.0 MihoyoCalendar/2.0'

GAME_ASSETS = {
    'genshin': {'wiki': 'ys', 'avatar': 'File:{n}.png', 'portrait': 'File:{n}立绘.png',
                'width': 420, 'sub': ''},
    'starrail': {'wiki': 'sr', 'avatar': 'File:{n}.png', 'portrait': 'File:{n}立绘.png',
                 'width': 320, 'sub': 'sr'},
    'zzz': {'wiki': 'zzz', 'avatar': 'File:角色头像-{n}.png', 'portrait': 'File:角色立绘-{n}.png',
            'width': 420, 'sub': 'zzz'},
}


def api(wiki, params, retries=3):
    url = f'https://wiki.biligame.com/{wiki}/api.php?' + urllib.parse.urlencode(params)
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA,
                                                       'Referer': f'https://wiki.biligame.com/{wiki}/'})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode('utf-8'))
        except Exception as e:
            last = e
            time.sleep(1.2 * (i + 1))
    raise last


def download(url, dest: Path, headers, retries=3):
    """按真实格式决定扩展名（缩略图常为 JPEG 却带 .png 名）"""
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            if len(data) < 100:
                raise IOError('文件过小')
            if data[:8] == b'\x89PNG\r\n\x1a\n':
                ext = '.png'
            elif data[:3] == b'\xff\xd8\xff':
                ext = '.jpg'
            elif data[:4] == b'RIFF' and data[8:12] == b'WEBP':
                ext = '.webp'
            else:
                ext = dest.suffix
            dest = dest.with_suffix(ext)
            dest.write_bytes(data)
            return dest
        except Exception as e:
            if i == retries - 1:
                print(f'    ✗ {dest.name}: {e}')
                return None
            time.sleep(1.0 * (i + 1))
    return None


def safe(name):
    return re.sub(r'[\\/:*?"<>|]', '_', name)


def image_urls(wiki, titles, width=None):
    out = {}
    for i in range(0, len(titles), 40):
        params = {'action': 'query', 'format': 'json', 'prop': 'imageinfo',
                  'iiprop': 'url|size', 'titles': '|'.join(titles[i:i + 40])}
        if width:
            params['iiurlwidth'] = str(width)
        d = api(wiki, params)
        for pid, p in d.get('query', {}).get('pages', {}).items():
            ii = p.get('imageinfo')
            if pid == '-1' or not ii:
                continue
            url = ii[0].get('thumburl') or ii[0].get('url')
            if url:
                out[p['title']] = url
        time.sleep(0.25)
    return out


def names_of(gid):
    f = DATA / 'games' / f'{gid}.json'
    if not f.exists():
        return []
    g = json.loads(f.read_text(encoding='utf-8'))
    names, seen = [], set()
    for b in g.get('banners', []):
        for cb in b.get('character', []):
            for n in list(cb.get('five', [])) + list(cb.get('four', [])):
                if n and n not in seen:
                    seen.add(n)
                    names.append(n)
    return names


def run(gid, force=False):
    cfg = GAME_ASSETS[gid]
    wiki = cfg['wiki']
    names = names_of(gid)
    if not names:
        print(f'  · {gid}: 没有角色数据，跳过')
        return {}
    adir = DATA / 'avatars' / cfg['sub'] if cfg['sub'] else DATA / 'avatars'
    pdir = DATA / 'portraits' / cfg['sub'] if cfg['sub'] else DATA / 'portraits'
    adir.mkdir(parents=True, exist_ok=True)
    pdir.mkdir(parents=True, exist_ok=True)
    if force:
        for f in list(adir.glob('*')) + list(pdir.glob('*')):
            if f.is_file():
                f.unlink()

    print(f'  · {gid}: {len(names)} 名角色，查询图片地址…')
    headers = {'User-Agent': UA, 'Referer': f'https://wiki.biligame.com/{wiki}/'}
    av_titles = [cfg['avatar'].format(n=n) for n in names]
    pr_titles = [cfg['portrait'].format(n=n) for n in names]
    av_urls = image_urls(wiki, av_titles)
    pr_urls = image_urls(wiki, pr_titles, width=cfg['width'])

    assets, ok_a, ok_p = {}, 0, 0
    for idx, n in enumerate(names, 1):
        entry = {}
        a_url = av_urls.get('文件:' + cfg['avatar'].format(n=n)[5:])
        p_url = pr_urls.get('文件:' + cfg['portrait'].format(n=n)[5:])
        if a_url:
            final = download(a_url, adir / (safe(n) + '.png'), headers)
            if final:
                entry['avatar'] = str(final.relative_to(HERE)).replace('\\', '/')
                ok_a += 1
        if p_url:
            final = download(p_url, pdir / (safe(n) + '.png'), headers)
            if final:
                entry['portrait'] = str(final.relative_to(HERE)).replace('\\', '/')
                ok_p += 1
        if entry:
            assets[n] = entry
        if idx % 25 == 0:
            print(f'    {idx}/{len(names)} …')
    print(f'  ✓ {gid}: 头像 {ok_a}，立绘 {ok_p}')
    return assets


def main():
    force = '--force' in sys.argv
    targets = []
    for i, a in enumerate(sys.argv):
        if a == '--game' and i + 1 < len(sys.argv):
            targets.append(sys.argv[i + 1])
    if not targets:
        targets = list(GAME_ASSETS)

    # 保留其他游戏已有结果
    out_path = DATA / 'assets.js'
    all_assets = {}
    if out_path.exists() and not force:
        m = re.search(r'const ASSETS_BY_GAME = (\{.*\});', out_path.read_text(encoding='utf-8'), re.S)
        if m:
            try:
                all_assets = json.loads(m.group(1))
            except Exception:
                all_assets = {}

    for gid in targets:
        all_assets[gid] = run(gid, force)

    body = json.dumps(all_assets, ensure_ascii=False, indent=1, sort_keys=True)
    out_path.write_text(
        '// 由 fetch_assets.py 生成，来源：bilibili 各游戏 Wiki 角色头像/立绘\n'
        'const ASSETS_BY_GAME = ' + body + ';\n', encoding='utf-8')
    total = sum(f.stat().st_size for f in DATA.rglob('*') if f.suffix in ('.png', '.jpg', '.webp'))
    print(f'完成，图片合计 {total / 1048576:.1f} MB，写入 {out_path}')
    print('刷新浏览器即可看到角色图片。')


if __name__ == '__main__':
    main()
