/* 米哈游游戏日历 —— 原神 / 崩坏：星穹铁道 / 绝区零 / 星布谷地
   总览模式：四款游戏事件合并到同一张日历，跨游戏查角色
   数据由 update_data.py 生成到 data/games.js（GAMES_DATA） */
(function () {
  'use strict';

  // ---------- 基础工具 ----------
  const DAY = 24 * 3600 * 1000;
  const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const today = () => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); };
  const addDays = (d, n) => new Date(d.getTime() + n * DAY);
  const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const GAMES = (typeof GAMES_DATA !== 'undefined' && GAMES_DATA.games) ? GAMES_DATA.games : [];
  if (!GAMES.length) {
    document.getElementById('calendar').innerHTML = '<p class="muted" style="padding:20px">缺少 data/games.js，请先运行 <code>python update_data.py</code></p>';
    return;
  }
  const GENERATED = (typeof GAMES_DATA !== 'undefined' && GAMES_DATA.generated) || '';

  // 事件优先级（同日排序）
  const PRIORITY = { launch: 1, update: 1, phase1: 2, phase2: 2, live: 3, splash: 4, event: 4, pv: 5, code: 6 };
  // 事件类型缩写（总览格子用）
  const TYPE_ABBR = {
    update: '更新', launch: '上线', phase1: '上半', phase2: '下半',
    live: '前瞻', splash: '立绘', pv: 'PV', code: '码', event: '活动',
  };

  // ---------- 角色图片 ----------
  const ASSETS = (typeof ASSETS_BY_GAME !== 'undefined') ? ASSETS_BY_GAME : {};

  function assetOf(gid, name) {
    return (ASSETS[gid] || {})[name] || {};
  }
  function avaHTML(name, size, gid) {
    const s = size || 30;
    const a = gid ? assetOf(gid, name).avatar : null;
    const gtag = gid ? ` data-gid="${esc(gid)}"` : '';
    if (a) {
      return `<img class="ava" src="${a}" width="${s}" height="${s}" loading="lazy"
        alt="${esc(name)}" title="${esc(name)}" data-char="${esc(name)}"${gtag}>`;
    }
    return `<span class="ava ph" style="width:${s}px;height:${s}px;line-height:${s}px"
      title="${esc(name)}" data-char="${esc(name)}"${gtag}>${esc(name.slice(0, 1))}</span>`;
  }
  function avaRow(names, size, gid) {
    const uniq = [];
    for (const n of names) if (n && uniq.indexOf(n) < 0) uniq.push(n);
    return `<div class="ava-row">${uniq.map((n) => avaHTML(n, size || 34, gid)).join('')}</div>`;
  }

  // ---------- 单个游戏的模型 ----------
  function buildModel(g) {
    const R = Object.assign({
      VERSION_DAYS: 42, MINOR_MAX: 8, HALF2_OFFSET: 20,
      LIVE_OFFSET: -12, LIVE_TIME: '', CODE_EXPIRE_DAYS: 3, CODE_EXPIRE_TIME: '12:00',
      SPLASH_FIRST: -8, PV_LAST: -6, DEMO_LAST: -1, RERUN_FIRST: -3,
      HAS_DEMO: false, RERUN_INTRO: false, MILESTONE_ONLY: false,
      PHASE_WORD: '卡池', WEAPON_WORD: '武器池',
    }, g.rules || {});

    const banners = (g.banners || []).map((b) => Object.assign({}, b));
    const byPhase = {};
    for (const b of banners) byPhase[b.phase] = b;

    // 角色首次登场（判断是否新角色 → 是否有立绘/PV/演示）
    const firstSeen = {};
    for (const b of banners.slice().sort((x, y) => x.start.localeCompare(y.start))) {
      for (const cb of b.character || []) {
        for (const n of cb.five || []) if (!firstSeen[n]) firstSeen[n] = { rarity: 5, date: b.start, phase: b.phase, version: b.version };
        for (const n of cb.four || []) if (!firstSeen[n]) firstSeen[n] = { rarity: 4, date: b.start, phase: b.phase, version: b.version };
      }
    }
    const newCharsOf = (version) => {
      const five = [], four = [];
      for (const n in firstSeen) {
        const f = firstSeen[n];
        if (f.version !== version) continue;
        (f.rarity === 5 ? five : four).push(n);
      }
      return { five, four };
    };

    // 版本时间线（真实 + 预测）
    const versions = buildTimeline(g, R);

    const events = [];
    for (const v of versions) events.push(...eventsForVersion(g, v, { R, byPhase, newCharsOf }));
    for (const m of (g.milestones || [])) {
      events.push({
        date: m.date, type: m.type || 'event', priority: PRIORITY[m.type] || 4,
        predicted: !!m.predicted, title: m.title, detail: m.detail || '',
        time: m.time || '',
      });
    }
    events.sort((a, b) => (a.date === b.date ? (a.priority - b.priority) : a.date.localeCompare(b.date)));

    // 每天是否处于在售卡池周期内（日历顶部色条）
    const bannerOn = {};
    for (const b of banners) {
      let d = parse(b.start);
      const end = parse(b.end);
      while (d <= end) {
        bannerOn[fmt(d)] = (b.half === '下半' || b.half === '额外') ? 'p2' : 'p1';
        d = addDays(d, 1);
      }
    }

    // 角色 UP 记录
    const charIndex = {};
    for (const b of banners) {
      for (const cb of b.character || []) {
        for (const n of cb.five || []) (charIndex[n] = charIndex[n] || []).push({ phase: b.phase, start: b.start, kind: '5★', pool: cb.name, four: cb.four || [] });
        for (const n of cb.four || []) (charIndex[n] = charIndex[n] || []).push({ phase: b.phase, start: b.start, kind: '4★', pool: cb.name, four: cb.four || [] });
      }
    }

    return { game: g, R, banners, byPhase, versions, events, bannerOn, charIndex, firstSeen };
  }

  function buildTimeline(g, R) {
    const data = (g.versions || []).map((v) => Object.assign({}, v));
    const known = new Set(data.map((v) => v.version));
    for (const b of (g.banners || [])) {
      if (known.has(b.version)) continue;
      data.push({ version: b.version, major: false, start: b.start, title: '（版本详情待补充）', characters: '', region: '', fromBanner: true });
      known.add(b.version);
    }
    data.sort((x, y) => x.start.localeCompare(y.start));
    if (!R.VERSION_DAYS) return data;   // 星布谷地这类尚未进入版本周期的游戏

    const last = data[data.length - 1];
    const m = /^(\d+)\.(\d+)$/.exec(last.version || '');
    let major = m ? +m[1] : 1;
    let minor = m ? +m[2] : 0;
    const maxMinor = R.MINOR_MAX || 8;
    let cur = parse(last.start);
    for (let i = 1; i <= 9; i++) {
      minor++;
      if (minor > maxMinor) { major++; minor = 0; }
      cur = addDays(cur, R.VERSION_DAYS);
      data.push({
        version: `${major}.${minor}`, major: minor === 0,
        start: fmt(cur), title: minor === 0 ? '新篇章（待官宣）' : '（规律预测）',
        characters: '', region: '', predicted: true,
      });
    }
    return data;
  }

  function eventsForVersion(g, ver, ctx) {
    const { R, byPhase, newCharsOf } = ctx;
    const v = ver.version;
    const start = parse(ver.start);
    const pred = !!ver.predicted;
    const evts = [];
    if (R.MILESTONE_ONLY) return evts;          // 里程碑型游戏（星布谷地）只用 milestones

    const p1 = byPhase[v + '上半'];
    const p2 = byPhase[v + '下半'];
    const nc = newCharsOf(v);
    const t = ver.title || '';
    const isPlaceholder = !t || /^（/.test(t);

    evts.push({
      date: ver.start, type: 'update', priority: 1, predicted: pred,
      title: `${v} 版本更新${isPlaceholder ? '' : `「${t}」`}`,
      detail: [
        ver.region ? `新内容：${ver.region}` : '',
        ver.characters ? `新角色：${ver.characters}` : '',
        ver.major ? '大版本更新：新篇章开启' : '',
        isPlaceholder ? (ver.fromBanner ? '版本主题尚未收录，卡池阵容可在下方查看' : '按官方版本周期推算的更新日') : '',
      ].filter(Boolean).join('｜') || '维护结束后开启新版本',
    });

    const phaseEvt = (banner, fb, halfLabel, type) => {
      if (banner) {
        const five = (banner.character || []).map((c) => (c.five || []).join('/')).join(' ＋ ');
        const chars = [];
        for (const cb of banner.character || []) chars.push(...(cb.five || []), ...(cb.four || []));
        evts.push({
          date: banner.start, type, priority: 2, predicted: false, banner, chars,
          title: `${v}${halfLabel}${R.PHASE_WORD} · ${five}`,
          detail: (banner.character || []).map((cb) => {
            const f = (cb.five || []).join('、') || '—';
            const fo = (cb.four || []).join('、');
            return `【${cb.name}】UP 5★：${f}${fo ? `｜4★：${fo}` : ''}`;
          }).concat(
            banner.weapon && (banner.weapon.five || []).length ? [`${R.WEAPON_WORD} 5★：${banner.weapon.five.join('、')}`] : []
          ).concat([`${banner.start} ${banner.startTime || ''} ~ ${banner.end}`]).join('\n'),
        });
      } else if (fb) {
        evts.push({
          date: fb, type, priority: 2, predicted: true,
          title: `${v}${halfLabel}${R.PHASE_WORD}开启（角色待官宣）`,
          detail: `按规律预计 ${fb} 开启`,
        });
      }
    };
    // 下半日期：优先按规律推算；该版本已有真实卡池结束更晚时顺延一天
    const half2Fallback = () => {
      if (R.HALF2_OFFSET == null) return null;
      let fb = fmt(addDays(start, R.HALF2_OFFSET));
      const ends = [];
      for (const k in byPhase) if (byPhase[k].version === v && byPhase[k].end) ends.push(byPhase[k].end);
      const lastEnd = ends.sort().pop();
      if (lastEnd && lastEnd >= fb) fb = fmt(addDays(parse(lastEnd), 1));
      return fb;
    };
    phaseEvt(p1, ver.start, '上半', 'phase1');
    phaseEvt(p2, half2Fallback(), '下半', 'phase2');

    // 少见的「中/额外」期卡池
    for (const key in byPhase) {
      const b = byPhase[key];
      if (b.version !== v) continue;
      if (b.half !== '中' && b.half !== '额外') continue;
      const five = (b.character || []).map((c) => (c.five || []).join('/')).join(' ＋ ');
      const chars = [];
      for (const cb of b.character || []) chars.push(...(cb.five || []), ...(cb.four || []));
      evts.push({
        date: b.start, type: 'phase2', priority: 2, predicted: false, banner: b, chars,
        title: `${v}${b.half === '中' ? '中期' : '额外'}${R.PHASE_WORD} · ${five}`,
        detail: (b.character || []).map((cb) => `【${cb.name}】UP 5★：${(cb.five || []).join('、')}`).join('\n'),
      });
    }

    // 前瞻直播 / 版本 PV / 兑换码
    if (R.LIVE_OFFSET != null) {
      const live = addDays(start, R.LIVE_OFFSET);
      evts.push({
        date: fmt(live), type: 'live', priority: 3, predicted: true,
        title: `${v} 前瞻特别节目`,
        detail: `${R.LIVE_TIME} 直播，公布下版本内容并发放兑换码｜当晚同步发布版本 PV`,
      });
      evts.push({
        date: fmt(live), type: 'pv', priority: 5, predicted: true,
        title: `${v} 版本PV`,
        detail: '前瞻直播当晚于 B 站发布版本 PV',
      });
      if (R.CODE_EXPIRE_DAYS != null) {
        evts.push({
          date: fmt(addDays(live, R.CODE_EXPIRE_DAYS)), type: 'code', priority: 6, predicted: true,
          title: `${v} 前瞻兑换码 ${R.CODE_EXPIRE_TIME} 过期`,
          detail: R.CODE_NOTE || '以官方公告为准',
        });
      }
    }

    // 新角色发布节奏
    const newIn = (banner, rarity) => {
      if (!banner) return [];
      const src = rarity === 5 ? nc.five : nc.four;
      const out = [];
      for (const cb of banner.character || []) {
        for (const n of (rarity === 5 ? cb.five : cb.four) || []) {
          if (src.includes(n) && !out.includes(n)) out.push(n);
        }
      }
      return out;
    };
    const p1Five = newIn(p1, 5);
    const p1Four = newIn(p1, 4);
    const p1Start = p1 ? parse(p1.start) : start;

    if (R.SPLASH_FIRST != null) {
      p1Five.concat(p1Four).forEach((n, i) => {
        evts.push({
          date: fmt(addDays(p1Start, R.SPLASH_FIRST + i)), type: 'splash', priority: 4, predicted: true,
          title: `${v} 新角色立绘 · ${n}`,
          detail: '官方发布角色立绘与介绍图文，多名角色分日发布，实际日期可能 ±2 天｜点击头像看详情',
          chars: [n],
        });
      });
    }
    if (R.PV_LAST != null) {
      p1Five.forEach((n, i) => {
        const off = R.PV_LAST - (p1Five.length - 1 - i);
        evts.push({
          date: fmt(addDays(p1Start, off)), type: 'pv', priority: 5, predicted: true,
          title: `${v}上半 角色PV · ${n}`,
          detail: '角色 PV 于 B 站发布，通常在上半开启前数日',
          chars: [n],
        });
      });
    }
    if (R.HAS_DEMO && R.DEMO_LAST != null) {
      const demo = p1Four.concat(p1Five);
      demo.forEach((n, i) => {
        const off = R.DEMO_LAST - (demo.length - 1 - i);
        evts.push({
          date: fmt(addDays(p1Start, off)), type: 'pv', priority: 5, predicted: true,
          title: `${v}上半 角色演示 · ${n}`,
          detail: '《原神》角色预告-「XX：YY」（技能实机）于 B 站 12:00 发布，卡池开启前 1~2 天',
          chars: [n],
        });
      });
    }
    if (R.RERUN_INTRO && p2 && R.RERUN_FIRST != null) {
      const p2Start = parse(p2.start);
      const p2Five = [];
      for (const cb of p2.character || []) for (const n of cb.five || []) if (!p2Five.includes(n)) p2Five.push(n);
      p2Five.forEach((n, i) => {
        evts.push({
          date: fmt(addDays(p2Start, R.RERUN_FIRST + i)), type: 'splash', priority: 4, predicted: true,
          title: `${v}下半 角色介绍 · ${n}`,
          detail: '下半卡池开启前 3~2 天 12:00 于 B 站发布角色介绍 / 复刻预告图文',
          chars: [n],
        });
      });
    }
    return evts.filter((e) => e.date);
  }

  // ---------- 合并四款游戏 ----------
  const models = {};
  function modelOf(gid) {
    if (!models[gid]) models[gid] = buildModel(GAMES.find((g) => g.id === gid));
    return models[gid];
  }

  function combined() {
    const events = [];
    const evByDate = {};
    const bannerOn = {};
    for (const g of GAMES) {
      const m = modelOf(g.id);
      const meta = {
        gid: g.id, gname: g.name, gshort: g.short || g.name, gicon: g.icon || '★',
        accent: g.accent || '#c8a45c', gbadge: (g.short || g.name).slice(0, 1),
        pw: m.R.PHASE_WORD,
      };
      for (const e of m.events) {
        const ev = Object.assign({}, e, meta);
        events.push(ev);
        (evByDate[ev.date] = evByDate[ev.date] || []).push(ev);
      }
      for (const d in m.bannerOn) (bannerOn[d] = bannerOn[d] || {})[g.id] = m.bannerOn[d];
    }
    events.sort((a, b) => (a.date === b.date ? a.priority - b.priority : a.date.localeCompare(b.date)));
    return { events, evByDate, bannerOn };
  }

  const C = combined();
  const M = {
    events: C.events, evByDate: C.evByDate, bannerOn: C.bannerOn,
    R: { PHASE_WORD: '卡池' },
  };

  function currentVersionOf(g) {
    const m = modelOf(g.id);
    const t = today();
    let cur = null;
    for (const v of m.versions) { if (parse(v.start) <= t) cur = v; else break; }
    if (!cur) return null;
    const s = parse(cur.start);
    const days = m.R.VERSION_DAYS;
    const e = days ? addDays(s, days) : null;
    return {
      v: cur, end: e,
      day: Math.floor((t - s) / DAY) + 1,
      pct: e ? Math.min(100, Math.max(0, ((t - s) / (e - s)) * 100)) : 0,
    };
  }

  function activeBannerOf(g) {
    const m = modelOf(g.id);
    const ds = fmt(today());
    return m.banners.find((b) => b.start <= ds && ds <= b.end) || null;
  }

  // ---------- 渲染：月历 ----------
  let viewYear, viewMonth;
  const cal = document.getElementById('calendar');
  const titleEl = document.getElementById('monthTitle');
  let selDate = null;

  function renderCalendar() {
    titleEl.textContent = `${viewYear}年${viewMonth + 1}月 · 四游戏总览`;
    cal.innerHTML = '';
    const first = new Date(viewYear, viewMonth, 1);
    const offset = (first.getDay() + 6) % 7;
    const t = fmt(today());
    const startCell = new Date(viewYear, viewMonth, 1 - offset);
    for (let i = 0; i < 42; i++) {
      const d = addDays(startCell, i);
      const ds = fmt(d);
      const cell = document.createElement('div');
      const inMonth = d.getMonth() === viewMonth;
      cell.className = 'day all-view' + (inMonth ? '' : ' empty');
      if (inMonth) {
        const dow = (d.getDay() + 6) % 7;
        if (dow >= 5) cell.classList.add('weekend');
        if (ds === t) cell.classList.add('today');
        if (ds === selDate) cell.classList.add('sel');
        cell.innerHTML = `<span class="num ${ds === t ? 'today-num' : ''}">${d.getDate()}</span>`;

        renderStripes(cell, ds);
        renderDayEvents(cell, ds);

        cell.onclick = () => { selDate = ds; showDayDetail(ds); renderCalendar(); };
      }
      cal.appendChild(cell);
    }
  }

  // 每个游戏一条色带（上浅下深区分上下半）
  function renderStripes(cell, ds) {
    const day = M.bannerOn[ds];
    if (!day || !Object.keys(day).length) return;
    const wrap = document.createElement('div');
    wrap.className = 'stripes';
    wrap.title = '卡池/跃迁/频段进行中（每行一款游戏）';
    for (const g of GAMES) {
      const v = day[g.id];
      const s = document.createElement('i');
      s.style.background = v ? (g.accent || '#999') : 'transparent';
      s.style.opacity = v === 'p2' ? '.45' : '.95';
      wrap.appendChild(s);
    }
    cell.appendChild(wrap);
  }

  // 同一天按游戏分组，每款游戏一行（取当天最重要事件，其余折叠为 +N）
  function renderDayEvents(cell, ds) {
    const evts = M.evByDate[ds] || [];
    if (!evts.length) return;
    const groups = [];
    for (const g of GAMES) {
      const list = evts.filter((e) => e.gid === g.id).sort((a, b) => a.priority - b.priority);
      if (list.length) groups.push({ g, list });
    }
    const box = document.createElement('div');
    box.className = 'evts';
    for (const { g, list } of groups) {
      const e = list[0];
      const el = document.createElement('div');
      el.className = 'evt gline';
      el.style.setProperty('--gc', g.accent || '#8a8f9f');
      el.innerHTML = `<i class="gb" title="${esc(g.name)}">${esc((g.short || g.name).slice(0, 1))}</i>`
        + `<span class="et">${TYPE_ABBR[e.type] || ''}</span>`
        + `<span class="tx">${esc(shortTitle(e))}</span>`
        + (list.length > 1 ? `<b class="cnt">+${list.length - 1}</b>` : '');
      el.title = `【${g.name}】\n` + list.map((x) => `${TYPE_ABBR[x.type] || ''} ${x.title}${x.predicted ? '（预测）' : ''}`).join('\n');
      box.appendChild(el);
    }
    cell.appendChild(box);
  }

  // 总览格子的极简标题
  function shortTitle(e) {
    switch (e.type) {
      case 'update': return `${e.title.split(' ')[0]} 更新`;
      case 'launch': return '公测上线';
      case 'phase1':
      case 'phase2': return e.title.replace(/^.*?(卡池|跃迁|频段) · /, '').replace(/ ＋ /g, '/');
      case 'live': return '前瞻直播';
      case 'code': return '兑换码过期';
      case 'splash': return (e.title.split(' · ').pop() || e.title);
      case 'pv': return e.title.replace(/^\S+\s/, '');
      case 'event': return e.title;
    }
    return e.title;
  }

  function showDayDetail(ds) {
    const box = document.getElementById('dayDetail');
    const evts = (M.evByDate[ds] || []).slice().sort((a, b) => a.priority - b.priority);
    const d = parse(ds);
    const isToday = ds === fmt(today());
    let html = `<h3>${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 · 星期${WEEK[d.getDay()]}${isToday ? '<span class="detail-sub">今天</span>' : ''}</h3>`;
    if (!evts.length) {
      html += `<p class="muted">这一天没有记录的米哈游游戏事件。</p>`;
    } else {
      // 按游戏分组展示
      for (const g of GAMES) {
        const list = evts.filter((e) => e.gid === g.id);
        if (!list.length) continue;
        html += `<div class="dd-game" style="--gc:${g.accent}">
          <div class="dd-gname"><i></i>${esc(g.name)}</div>
          <ul class="evt-list">` + list.map((e) => `
            <li>
              <span class="evt ${e.type} inline">${typeName(e.type, e)}</span>
              <b>${esc(e.title)}</b>${e.predicted ? ' <span class="tag predicted">预测</span>' : ' <span class="tag real">资料</span>'}
              ${e.chars && e.chars.length ? avaRow(e.chars, 36, e.gid) : ''}
              ${e.detail ? `<div class="evt-detail">${esc(e.detail).replace(/\n/g, '<br>')}</div>` : ''}
            </li>`).join('') + '</ul></div>';
      }
    }
    box.innerHTML = html;
    box.classList.remove('hidden');
  }

  function typeName(t, e) {
    const pw = (e && e.pw) || '卡池';
    return {
      update: '版本更新', launch: '公测上线', phase1: '上半' + pw,
      phase2: '下半' + pw, live: '前瞻直播', code: '兑换码',
      splash: '立绘/介绍', pv: 'PV/演示', event: '活动/里程碑',
    }[t] || t;
  }

  // ---------- 渲染：提醒侧栏 ----------
  let rangeDays = 14;
  function renderUpcoming() {
    const t = today();
    const list = document.getElementById('upcomingList');
    const items = M.events
      .filter((e) => { const dd = (parse(e.date) - t) / DAY; return dd >= 0 && dd <= rangeDays; })
      .map((e) => ({ e, dd: Math.round((parse(e.date) - t) / DAY) }));
    if (!items.length) {
      list.innerHTML = '<li><span class="muted">这段时间暂无事件，翻翻后面的月份看看～</span></li>';
      return;
    }
    let lastDate = '';
    list.innerHTML = items.map(({ e, dd }) => {
      const cls = dd <= 1 ? 'd0' : dd <= 3 ? 'd1' : dd <= 7 ? 'd7' : 'd30';
      const label = dd === 0 ? '今天' : dd === 1 ? '明天' : `${dd}天后`;
      const d = parse(e.date);
      const dateHead = e.date !== lastDate
        ? `<li class="date-head">${d.getMonth() + 1}月${d.getDate()}日 · 星期${WEEK[d.getDay()]}</li>` : '';
      lastDate = e.date;
      return `${dateHead}<li>
        <span class="days ${cls}">${label}</span>
        <span class="evt-title">
          <i class="gdot" style="background:${e.accent}"></i><span class="gname">${esc(e.gshort)}</span>
          ${esc(e.title)}${e.predicted ? ' <span class="tag predicted">预测</span>' : ''}
        </span>
      </li>`;
    }).join('');
  }

  // ---------- 渲染：各游戏在售 ----------
  function renderAllBanners() {
    const box = document.getElementById('currentBanner');
    const t = fmt(today());
    box.innerHTML = GAMES.map((g) => {
      const m = modelOf(g.id);
      const b = activeBannerOf(g);
      let main = '', sub = '';
      if (b) {
        const five = (b.character || []).map((c) => (c.five || []).join('/')).filter(Boolean).join('、');
        const left = Math.round((parse(b.end) - today()) / DAY);
        main = `<b>${esc(b.phase)}</b> · ${esc(five || '阵容待补充')}`;
        sub = `剩 ${left} 天`;
      } else if (m.R.MILESTONE_ONLY) {
        const lm = (g.milestones || []).find((x) => x.type === 'launch');
        const left = Math.round((parse(lm ? lm.date : (g.versions[0] || { start: t }).start) - today()) / DAY);
        main = left > 0 ? '<b>未公测</b>' : '<b>已公测</b>';
        sub = left > 0 ? `距公测 ${left} 天` : '';
      } else {
        const opened = m.events
          .filter((e) => (e.type === 'phase1' || e.type === 'phase2') && e.date <= t)
          .sort((x, y) => x.date.localeCompare(y.date));
        const cur = opened.length ? opened[opened.length - 1] : null;
        main = cur
          ? `${esc(cur.title.replace(/（.*$/, ''))} <span class="tag predicted">推算</span>`
          : `<span class="muted">无在售${esc(m.R.PHASE_WORD)}</span>`;
      }
      return `<div class="gp-row" data-goto="${g.id}" style="--gc:${g.accent || '#999'}" title="点击查看《${esc(g.name)}》">
        <div class="gp-name"><i></i>${esc(g.short || g.name)}</div>
        <div class="gp-main">${main}</div>
        <div class="gp-sub">${sub}</div>
      </div>`;
    }).join('');
    box.querySelectorAll('[data-goto]').forEach((el) => {
      el.onclick = () => { jumpToGame(el.dataset.goto); };
    });
  }

  // 点击某游戏行 → 日历跳到该游戏下一次事件所在月份
  function jumpToGame(gid) {
    const g = GAMES.find((x) => x.id === gid);
    if (!g) return;
    const m = modelOf(gid);
    const t = fmt(today());
    const next = m.events.find((e) => e.date >= t && (e.type === 'phase1' || e.type === 'phase2' || e.type === 'update'));
    if (next) {
      const d = parse(next.date);
      viewYear = d.getFullYear(); viewMonth = d.getMonth();
      selDate = next.date;
      renderCalendar();
      showDayDetail(next.date);
    }
  }

  // ---------- 角色 UP 查询（跨四游戏） ----------
  function charIndexAll() {
    const out = [];
    for (const g of GAMES) {
      const m = modelOf(g.id);
      for (const n in m.charIndex) out.push({ gid: g.id, g, name: n, recs: m.charIndex[n], first: m.firstSeen[n] });
    }
    out.sort((a, b) => {
      const la = a.recs[a.recs.length - 1].start, lb = b.recs[b.recs.length - 1].start;
      return lb.localeCompare(la);
    });
    return out;
  }
  const CHAR_ALL = charIndexAll();

  // 最近 UP 的角色快捷入口
  function renderQuickChips() {
    const box = document.getElementById('quickChips');
    if (!box) return;
    box.innerHTML = CHAR_ALL.slice(0, 10).map(({ gid, g, name }) =>
      `<button class="qchip" data-q="${esc(name)}"><i style="background:${g.accent}"></i>${esc(name)}</button>`).join('');
    box.querySelectorAll('.qchip').forEach((btn) => {
      btn.onclick = () => {
        const el = document.getElementById('charSearch');
        el.value = btn.dataset.q;
        renderCharSearch(btn.dataset.q);
      };
    });
  }

  function renderCharSearch(q) {
    const box = document.getElementById('charResult');
    q = (q || '').trim();
    if (!q) {
      box.innerHTML = `<span class="muted">已收录 ${CHAR_ALL.length} 个角色，输入名字可查四款游戏的 UP 记录</span>`;
      return;
    }
    const hits = CHAR_ALL.filter((x) => x.name.includes(q));
    if (!hits.length) { box.innerHTML = `<span class="muted">没有找到「${esc(q)}」，试试完整名字。</span>`; return; }
    const t = today();
    box.innerHTML = hits.slice(0, 8).map(({ gid, g, name, recs, first }) => {
      const sorted = recs.slice().sort((a, b) => a.start.localeCompare(b.start));
      const last = sorted[sorted.length - 1];
      const gap = Math.round((t - parse(last.start)) / DAY);
      const isNew = first && first.date === sorted[0].start;
      return `<div class="char-block">
        <div class="char-head">${avaHTML(name, 34, gid)}
          <div class="char-info">
            <div class="char-name">${esc(name)}
              <span class="tag ${first && first.rarity === 5 ? 'five' : 'four'}">${(first && first.rarity) || '?'}★</span>
              ${isNew ? '<span class="tag real">首发</span>' : ''}
            </div>
            <div class="char-last">
              <span class="gtag sm" style="background:${g.accent}">${esc(g.short || g.name)}</span>
              最近 UP：${esc(last.phase)}（${last.start}）${gap > 0 ? `· ${gap} 天前` : '· 进行中'}
            </div>
          </div>
        </div>
        <div class="char-all">共 ${recs.length} 次：${sorted.map((r) => `<span class="chip" title="${esc(r.pool)}">${esc(r.phase)}</span>`).join('')}</div>
      </div>`;
    }).join('');
  }

  // ---------- 角色立绘弹窗 ----------
  function openCharModal(name, gidArg) {
    if (!gidArg) return;
    const m = modelOf(gidArg);
    const modal = document.getElementById('modal');
    const box = document.getElementById('modalContent');
    const recs = (m.charIndex[name] || []).slice().sort((a, b) => b.start.localeCompare(a.start));
    const f = m.firstSeen[name];
    const pr = assetOf(gidArg, name).portrait;
    box.innerHTML = `
      <div class="modal-head">
        ${avaHTML(name, 46, gidArg)}
        <div>
          <div class="modal-name">${esc(name)}
            ${f ? `<span class="tag ${f.rarity === 5 ? 'five' : 'four'}">${f.rarity}★</span>` : ''}
          </div>
          <div class="muted">${esc(m.game.name)} · ${f ? `首次登场：${esc(f.phase)}（${f.date}）` : '登场时间未知'}</div>
        </div>
      </div>
      ${pr ? `<img class="portrait" src="${pr}" alt="${esc(name)} 立绘">`
           : `<div class="muted" style="padding:18px 0">暂无立绘图片（新角色上线后 Wiki 补图即有）</div>`}
      <div class="modal-up">UP 记录（${recs.length} 次，倒序）</div>
      <div class="chip-list">${recs.map((r) => `<span class="chip" title="${esc(r.pool)}">${esc(r.phase)}</span>`).join('') || '<span class="muted">无常驻 UP 记录</span>'}</div>`;
    modal.classList.remove('hidden');
  }

  function setupModal() {
    const modal = document.getElementById('modal');
    document.getElementById('modalClose').onclick = () => modal.classList.add('hidden');
    modal.onclick = (e) => { if (e.target === modal) modal.classList.add('hidden'); };
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') modal.classList.add('hidden'); });
    document.addEventListener('click', (e) => {
      const el = e.target && e.target.closest ? e.target.closest('[data-char]') : null;
      if (el && el.dataset.char) openCharModal(el.dataset.char, el.dataset.gid);
    });
  }

  // ---------- 渲染：各游戏版本进度 ----------
  function renderAllVersions() {
    const box = document.getElementById('currentVersion');
    box.innerHTML = GAMES.map((g) => {
      const m = modelOf(g.id);
      if (m.R.MILESTONE_ONLY) {
        const lm = (g.milestones || []).find((x) => x.type === 'launch');
        const launch = parse(lm ? lm.date : (g.versions[0] || { start: fmt(today()) }).start);
        const left = Math.round((launch - today()) / DAY);
        return `<div class="gv-row" style="--gc:${g.accent || '#999'}">
          <div class="gv-head"><b class="gn">${esc(g.short || g.name)}</b>
            <span class="gv">${left > 0 ? '未公测' : '已公测'}</span>
            <em>${left > 0 ? `距公测 ${left} 天` : '已上线'}</em>
          </div>
          <div class="gv-bar"><i style="width:${left > 0 ? Math.max(2, 100 - Math.min(100, left)) : 100}%"></i></div>
        </div>`;
      }
      const c = currentVersionOf(g);
      if (!c) return '';
      return `<div class="gv-row" style="--gc:${g.accent || '#999'}" title="点击查看《${esc(g.name)}》" data-goto="${g.id}">
        <div class="gv-head"><b class="gn">${esc(g.short || g.name)}</b>
          <span class="gv">${esc(c.v.version)}</span>
          <em>第 ${c.day}/${m.R.VERSION_DAYS} 天${c.v.title && !/^（/.test(c.v.title) ? ` · ${esc(c.v.title)}` : ''}</em>
        </div>
        <div class="gv-bar"><i style="width:${c.pct.toFixed(1)}%"></i></div>
      </div>`;
    }).join('');
    box.querySelectorAll('[data-goto]').forEach((el) => { el.onclick = () => jumpToGame(el.dataset.goto); });
  }

  // ---------- 图例 / 说明 / 数据源 ----------
  function renderLegend() {
    const box = document.getElementById('legend');
    box.innerHTML = GAMES.map((g) => `<span><i class="dot" style="background:${g.accent}"></i>${esc(g.short || g.name)}</span>`).join('')
      + '<span class="lg-note">色带深＝上半 · 浅＝下半 · 点格子看当天详情</span>';
  }

  function renderHelp() {
    const li = [];
    const verCount = GAMES.reduce((n, x) => n + modelOf(x.id).versions.length, 0);
    const banCount = GAMES.reduce((n, x) => n + modelOf(x.id).banners.length, 0);
    li.push('一张日历同时显示原神 / 星铁 / 绝区零 / 星布谷地的版本更新、卡池开启、前瞻、立绘 PV 与里程碑。');
    li.push('每格按游戏分组，一行一款游戏：左侧色块是游戏，后面是事件类型与摘要；当天该游戏有多条时折叠成 <b>+N</b>，点格子看全部。');
    li.push('格子顶部每款游戏一条细色带：深色＝上半，浅色＝下半/额外，空白＝当天无在售。');
    li.push(`已收录 ${verCount} 个版本、${banCount} 期卡池/跃迁/频段；标 <span class="tag predicted">预测</span> 的为按 6 周版本的规律推算。`);
    li.push('「各游戏在售 / 各游戏版本」的行可以点击，日历会跳到该游戏下一个重要事件；点角色头像可看立绘与 UP 历史。');
    li.push('运行 <code>update_data.py</code> 刷新数据；<code>fetch_assets.py</code> 补充头像立绘。');
    document.getElementById('helpList').innerHTML = li.map((x) => `<li>${x}</li>`).join('');
    document.getElementById('footSources').innerHTML =
      '数据源：' + GAMES.map((x) => `<a href="https://wiki.biligame.com/${x.wiki || 'ys'}/" target="_blank">${esc(x.short || x.name)} Wiki</a>`).join(' / ')
      + ' + 米哈游官网公告 · '
      + `数据生成于 ${esc(GENERATED)} · 未来事件为规律推算，实际以官方公告为准`;
  }

  // ---------- 浏览器通知 ----------
  function setupNotify() {
    const btn = document.getElementById('btnNotify');
    if (!('Notification' in window)) { btn.textContent = '🔔 不支持通知'; btn.disabled = true; return; }
    btn.onclick = async () => {
      const p = await Notification.requestPermission();
      if (p !== 'granted') return;
      btn.textContent = '🔔 提醒已开启';
      const t = today();
      const soon = M.events.filter((e) => { const dd = (parse(e.date) - t) / DAY; return dd >= 0 && dd <= 3; });
      const body = soon.length
        ? soon.slice(0, 6).map((e) => `${e.date === fmt(t) ? '[今天] ' : e.date + ' '}[${e.gshort}] ${e.title}`).join('\n')
        : '未来 3 天没有米哈游游戏事件';
      new Notification('米哈游游戏日历', { body });
    };
    if (window.Notification && Notification.permission === 'granted') btn.textContent = '🔔 提醒已开启';
  }

  // ---------- 交互绑定 ----------
  document.getElementById('prevMonth').onclick = () => {
    viewMonth--; if (viewMonth < 0) { viewMonth = 11; viewYear--; } renderCalendar();
  };
  document.getElementById('nextMonth').onclick = () => {
    viewMonth++; if (viewMonth > 11) { viewMonth = 0; viewYear++; } renderCalendar();
  };
  document.getElementById('btnToday').onclick = () => {
    const t = today(); viewYear = t.getFullYear(); viewMonth = t.getMonth();
    selDate = fmt(t);
    renderCalendar(); showDayDetail(fmt(t));
  };
  document.querySelectorAll('.upcoming-tabs .tab').forEach((tab) => {
    tab.onclick = () => {
      document.querySelectorAll('.upcoming-tabs .tab').forEach((x) => x.classList.remove('active'));
      tab.classList.add('active');
      rangeDays = +tab.dataset.range;
      renderUpcoming();
    };
  });
  const searchEl = document.getElementById('charSearch');
  if (searchEl) {
    searchEl.addEventListener('input', (e) => renderCharSearch(e.target.value));
    searchEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') renderCharSearch(e.target.value); });
  }

  // ---------- 启动 ----------
  const t0 = today();
  viewYear = t0.getFullYear(); viewMonth = t0.getMonth();
  setupModal();
  setupNotify();
  renderLegend();
  renderHelp();
  renderCalendar();
  renderUpcoming();
  renderAllBanners();
  renderAllVersions();
  renderQuickChips();
  renderCharSearch('');
  showDayDetail(fmt(today()));
})();
