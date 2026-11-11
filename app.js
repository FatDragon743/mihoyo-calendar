/* 米哈游游戏日历 —— 原神 / 崩坏：星穹铁道 / 绝区零 / 星布谷地
   总览模式：四款游戏事件合并到同一张日历；侧栏信息按游戏标签切换
   数据由 update_data.py 生成到 data/games.js（GAMES_DATA） */
(function () {
  'use strict';

  // ---------- 基础工具 ----------
  const DAY = 24 * 3600 * 1000;
  const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
  const ALL_GID = '__all__';
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
    const tab = ASSETS[gid] || {};
    return tab[name] || {};
  }
  function avaHTML(name, size, gidArg) {
    const s = size || 30;
    const gid = gidArg || (GID === ALL_GID ? null : GID);
    const a = gid ? assetOf(gid, name).avatar : null;
    const gtag = gid ? ` data-gid="${esc(gid)}"` : '';
    if (a) {
      return `<img class="ava" src="${a}" width="${s}" height="${s}" loading="lazy"
        alt="${esc(name)}" title="${esc(name)}" data-char="${esc(name)}"${gtag}>`;
    }
    return `<span class="ava ph" style="width:${s}px;height:${s}px;line-height:${s}px"
      title="${esc(name)}" data-char="${esc(name)}"${gtag}>${esc(name.slice(0, 1))}</span>`;
  }
  function avaRow(names, size, gidArg) {
    const uniq = [];
    for (const n of names) if (n && uniq.indexOf(n) < 0) uniq.push(n);
    return `<div class="ava-row">${uniq.map((n) => avaHTML(n, size || 34, gidArg)).join('')}</div>`;
  }

  // ---------- 单个游戏的模型 ----------
  const models = {};
  function modelOf(gid) {
    if (gid === ALL_GID) return allModel();
    if (!models[gid]) models[gid] = buildModel(GAMES.find((g) => g.id === gid) || GAMES[0]);
    return models[gid];
  }

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
    const byDate = {};
    for (const b of banners) {
      byPhase[b.phase] = b;
      (byDate[b.start] = byDate[b.start] || []).push(b);
    }

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
    const versionsByKey = {};
    for (const v of versions) versionsByKey[v.version] = v;

    const events = [];
    for (const v of versions) events.push(...eventsForVersion(g, v, { R, byPhase, newCharsOf, firstSeen }));
    for (const m of (g.milestones || [])) {
      events.push({
        date: m.date, type: m.type || 'event', priority: PRIORITY[m.type] || 4,
        predicted: !!m.predicted, title: m.title, detail: m.detail || '',
        time: m.time || '',
      });
    }
    events.sort((a, b) => (a.date === b.date ? (a.priority - b.priority) : a.date.localeCompare(b.date)));

    const evByDate = {};
    for (const e of events) (evByDate[e.date] = evByDate[e.date] || []).push(e);

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

    return { game: g, R, banners, byPhase, byDate, versions, versionsByKey, firstSeen, newCharsOf, events, evByDate, bannerOn, charIndex };
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

  // ---------- 总览：合并四款游戏的事件 ----------
  let COMBINED = null;
  function combined() {
    if (COMBINED) return COMBINED;
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
    COMBINED = { events, evByDate, bannerOn };
    return COMBINED;
  }

  function allModel() {
    const c = combined();
    return {
      game: { id: ALL_GID, name: '米哈游游戏日历', short: '总览', icon: '✦', accent: '#c8a45c', tagline: '四款游戏合并总览' },
      R: { VERSION_DAYS: 42, PHASE_WORD: '卡池', WEAPON_WORD: '武器池', MILESTONE_ONLY: false },
      banners: [], byPhase: {}, versions: [], events: c.events,
      evByDate: c.evByDate, bannerOn: c.bannerOn, charIndex: {}, firstSeen: {},
    };
  }

  function isAll() { return GID === ALL_GID; }

  // ---------- 当前状态 ----------
  let GID = ALL_GID;
  try {
    const urlG = new URLSearchParams(location.search).get('game');
    const saved = urlG || localStorage.getItem('mihoyo-cal-game');
    if (saved === 'all' || saved === ALL_GID) GID = ALL_GID;
    else if (saved && GAMES.some((g) => g.id === saved)) GID = saved;
  } catch (e) { /* file:// 下可能被禁用 */ }

  let M = null;

  function currentVersionOf(m) {
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
  function currentVersion() { return currentVersionOf(M); }

  function activeBannerOf(m) {
    const ds = fmt(today());
    return m.banners.find((b) => b.start <= ds && ds <= b.end) || null;
  }

  // ---------- 渲染：游戏切换 ----------
  function renderTabs() {
    const box = document.getElementById('gameTabs');
    const items = [{ id: ALL_GID, name: '总览', short: '总览', icon: '✦', accent: '#c8a45c' }].concat(GAMES);
    box.innerHTML = items.map((g) => `
      <button class="game-tab${g.id === GID ? ' active' : ''}" data-gid="${g.id}" title="${esc(g.name)}">
        <span class="gt-icon" style="color:${g.accent}">${g.icon || '★'}</span>${esc(g.short || g.name)}
      </button>`).join('');
    box.querySelectorAll('.game-tab').forEach((btn) => {
      btn.onclick = () => selectGame(btn.dataset.gid);
    });
  }

  // ---------- 渲染：月历 ----------
  let viewYear, viewMonth;
  const cal = document.getElementById('calendar');
  const titleEl = document.getElementById('monthTitle');

  function renderCalendar() {
    const all = isAll();
    titleEl.textContent = `${viewYear}年${viewMonth + 1}月` + (all ? ' · 四游戏总览' : '');
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
      cell.className = 'day' + (inMonth ? '' : ' empty') + (all ? ' all-view' : '');
      if (inMonth) {
        const dow = (d.getDay() + 6) % 7;
        if (dow >= 5) cell.classList.add('weekend');
        if (ds === t) cell.classList.add('today');
        cell.innerHTML = `<span class="num ${ds === t ? 'today-num' : ''}">${d.getDate()}</span>`;

        if (all) {
          renderAllStripes(cell, ds);
          renderAllDayEvents(cell, ds);
        } else {
          const stripe = M.bannerOn[ds];
          if (stripe) {
            const s = document.createElement('i');
            s.className = 'stripe ' + stripe;
            s.title = M.R.PHASE_WORD + '进行中';
            cell.appendChild(s);
          }
          const evts = (M.evByDate[ds] || []).slice().sort((a, b) => a.priority - b.priority);
          if (evts.length) {
            const box = document.createElement('div');
            box.className = 'evts';
            for (const e of evts.slice(0, 3)) {
              const el = document.createElement('div');
              el.className = 'evt ' + e.type;
              el.textContent = shortTitle(e);
              el.title = e.title;
              box.appendChild(el);
            }
            if (evts.length > 3) {
              const more = document.createElement('div');
              more.className = 'evt more';
              more.textContent = `还有 ${evts.length - 3} 项…`;
              box.appendChild(more);
            }
            cell.appendChild(box);
          }
        }
        cell.onclick = () => showDayDetail(ds);
      }
      cal.appendChild(cell);
    }
  }

  // 总览：每个游戏一条色带（上浅下深区分上下半）
  function renderAllStripes(cell, ds) {
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

  // 总览：同一天按游戏分组，每款游戏一行（取当天最重要事件，其余折叠为 +N）
  function renderAllDayEvents(cell, ds) {
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
        + `<span class="tx">${esc(shortTitleAll(e))}</span>`
        + (list.length > 1 ? `<b class="cnt">+${list.length - 1}</b>` : '');
      el.title = `【${g.name}】\n` + list.map((x) => `${TYPE_ABBR[x.type] || ''} ${x.title}${x.predicted ? '（预测）' : ''}`).join('\n');
      box.appendChild(el);
    }
    cell.appendChild(box);
  }

  // 总览格子的极简标题
  function shortTitleAll(e) {
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

  function shortTitle(e) {
    switch (e.type) {
      case 'update': return `${e.title.split(' ')[0]} 更新`;
      case 'launch': return '公测上线';
      case 'phase1': return '上半 · ' + e.title.replace(/^.*?(卡池|跃迁|频段) · /, '');
      case 'phase2': return '下半 · ' + e.title.replace(/^.*?(卡池|跃迁|频段) · /, '');
      case 'live': return '前瞻直播';
      case 'code': return '兑换码过期';
      case 'splash': return '立绘/介绍 · ' + (e.title.split(' · ').pop() || e.title);
      case 'pv': return e.title.replace(/^\S+\s/, '');
      case 'event': return e.title.length > 10 ? e.title.slice(0, 9) + '…' : e.title;
    }
    return e.title;
  }

  function showDayDetail(ds) {
    const box = document.getElementById('dayDetail');
    const all = isAll();
    const evts = (M.evByDate[ds] || []).slice().sort((a, b) => a.priority - b.priority);
    const d = parse(ds);
    let html = `<h3>${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 · 星期${WEEK[d.getDay()]}`
      + (all ? '<span class="detail-sub">四款游戏合并</span>' : '') + '</h3>';
    if (!evts.length) {
      html += `<p class="muted">这一天没有记录的${all ? '米哈游游戏' : esc(M.game.name)}事件。</p>`;
    } else {
      html += '<ul class="evt-list">' + evts.map((e) => `
        <li>
          ${all ? `<span class="evt inline gtag" style="background:${e.accent}">${esc(e.gshort)}</span>` : ''}
          <span class="evt ${e.type} inline">${typeName(e.type, e)}</span>
          <b>${esc(e.title)}</b>${e.predicted ? ' <span class="tag predicted">预测</span>' : ' <span class="tag real">资料</span>'}
          ${e.chars && e.chars.length ? avaRow(e.chars, 36, e.gid) : ''}
          ${e.detail ? `<div class="evt-detail">${esc(e.detail).replace(/\n/g, '<br>')}</div>` : ''}
        </li>`).join('') + '</ul>';
    }
    box.innerHTML = html;
    box.classList.remove('hidden');
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function typeName(t, e) {
    const pw = (e && e.pw) || (M && M.R ? M.R.PHASE_WORD : '卡池');
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
    const all = isAll();
    const list = document.getElementById('upcomingList');
    const items = M.events
      .filter((e) => { const dd = (parse(e.date) - t) / DAY; return dd >= 0 && dd <= rangeDays; })
      .map((e) => ({ e, dd: Math.round((parse(e.date) - t) / DAY) }));
    if (!items.length) {
      list.innerHTML = '<li><span class="muted">这段时间暂无事件，翻翻后面的月份看看～</span></li>';
      return;
    }
    list.innerHTML = items.map(({ e, dd }) => {
      const cls = dd <= 1 ? 'd0' : dd <= 3 ? 'd1' : dd <= 7 ? 'd7' : 'd30';
      const label = dd === 0 ? '今天' : dd === 1 ? '明天' : `${dd}天后`;
      const d = parse(e.date);
      return `<li>
        <span class="days ${cls}">${label}</span>
        <span class="evt-title">
          ${all ? `<i class="gdot" style="background:${e.accent}"></i><span class="gname">${esc(e.gshort)}</span>` : ''}
          ${esc(e.title)}${e.predicted ? ' <span class="tag predicted">预测</span>' : ''}
          <br><span class="evt-date">${d.getMonth() + 1}月${d.getDate()}日 · 星期${WEEK[d.getDay()]}</span>
        </span>
      </li>`;
    }).join('');
  }

  // ---------- 渲染：当前 UP ----------
  function renderCurrentBanner() {
    if (isAll()) { renderAllBanners(); return; }
    const box = document.getElementById('currentBanner');
    const b = activeBannerOf(M);
    if (!b) {
      const t = fmt(today());
      const opened = M.events
        .filter((e) => (e.type === 'phase1' || e.type === 'phase2') && e.date <= t)
        .sort((x, y) => x.date.localeCompare(y.date));
      const cur = opened.length ? opened[opened.length - 1] : null;
      const next = M.banners.find((x) => x.start > t);
      let html = '';
      if (cur) {
        html += `<div class="banner-phase">${esc(cur.title)} <span class="tag predicted">推算进行中</span></div>
          <div class="muted" style="margin-bottom:6px">阵容尚未收录，以官方公告为准</div>`;
      } else {
        html += `<span class="muted">当前没有在售${esc(M.R.PHASE_WORD)}</span>`;
      }
      if (next) html += `<div class="banner-range">下一期：${next.start} ${next.phase}</div>`;
      box.innerHTML = html;
      return;
    }
    const t = fmt(today());
    const left = Math.round((parse(b.end) - parse(t)) / DAY);
    box.innerHTML = `
      <div class="banner-phase">${b.phase} <span class="muted">剩余 ${left} 天</span></div>
      ${(b.character || []).map((c) => `
        <div class="banner-pool">
          <div class="pool-name">${esc(c.name)}</div>
          <div class="pool-five">${(c.five || []).map((n) => `<span class="pair">${avaHTML(n, 26)}${esc(n)}</span>`).join('')}</div>
          ${(c.four || []).length ? `<div class="pool-four">${c.four.map((n) => `<span class="pair">${avaHTML(n, 20)}${esc(n)}</span>`).join('')}</div>` : ''}
        </div>`).join('')}
      ${b.weapon && (b.weapon.five || []).length ? `<div class="banner-weapon">${M.R.WEAPON_WORD} ★5：${b.weapon.five.join('、')}</div>` : ''}
      <div class="banner-range">${b.start} ${b.startTime || ''} ~ ${b.end}</div>`;
  }

  // 总览：每款游戏一行摘要，点击跳到该游戏
  function renderAllBanners() {
    const box = document.getElementById('currentBanner');
    const t = fmt(today());
    box.innerHTML = GAMES.map((g) => {
      const m = modelOf(g.id);
      const b = activeBannerOf(m);
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
    box.querySelectorAll('[data-goto]').forEach((el) => { el.onclick = () => selectGame(el.dataset.goto); });
  }

  // ---------- 角色 UP 查询 ----------
  let CHAR_ALL = null;
  function charIndexAll() {
    if (CHAR_ALL) return CHAR_ALL;
    const out = [];
    for (const g of GAMES) {
      const m = modelOf(g.id);
      for (const n in m.charIndex) out.push({ gid: g.id, g, name: n, recs: m.charIndex[n], first: m.firstSeen[n] });
    }
    out.sort((a, b) => {
      const la = a.recs[a.recs.length - 1].start, lb = b.recs[b.recs.length - 1].start;
      return lb.localeCompare(la);
    });
    CHAR_ALL = out;
    return out;
  }

  function renderCharSearch(q) {
    if (isAll()) { renderCharSearchAll(q); return; }
    const box = document.getElementById('charResult');
    q = (q || '').trim();
    if (!q) { box.innerHTML = '<span class="muted">输入角色名可查其全部 UP 记录与距今时间</span>'; return; }
    const names = Object.keys(M.charIndex).filter((n) => n.includes(q));
    if (!names.length) { box.innerHTML = `<span class="muted">没有找到「${esc(q)}」，试试完整名字。</span>`; return; }
    const t = today();
    box.innerHTML = names.slice(0, 6).map((n) => {
      const recs = M.charIndex[n].slice().sort((a, b) => a.start.localeCompare(b.start));
      const last = recs[recs.length - 1];
      const gap = Math.round((t - parse(last.start)) / DAY);
      const f = M.firstSeen[n];
      const isNew = f && f.date === recs[0].start;
      return `<div class="char-block" data-char="${esc(n)}">
        <div class="char-head">${avaHTML(n, 38)}
          <div class="char-info">
            <div class="char-name">${esc(n)}
              <span class="tag ${f && f.rarity === 5 ? 'five' : 'four'}">${(f && f.rarity) || '?'}★</span>
              ${isNew ? '<span class="tag real">首发</span>' : ''}
            </div>
            <div class="char-last">最近 UP：${last.phase}（${last.start}）${gap > 0 ? `· ${gap} 天前` : '· 进行中'}</div>
          </div>
        </div>
        <div class="char-all">共 ${recs.length} 次：${recs.map((r) => `<span class="chip" title="${esc(r.pool)}">${r.phase}</span>`).join('')}</div>
      </div>`;
    }).join('');
  }

  // 总览：跨四款游戏查角色
  function renderCharSearchAll(q) {
    const box = document.getElementById('charResult');
    q = (q || '').trim();
    if (!q) {
      const n = charIndexAll().length;
      box.innerHTML = `<span class="muted">已收录 ${n} 个角色，输入名字可查四款游戏的 UP 记录</span>`;
      return;
    }
    const hits = charIndexAll().filter((x) => x.name.includes(q));
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
    const gid = gidArg || (isAll() ? null : GID);
    if (!gid) return;
    const m = modelOf(gid);
    const modal = document.getElementById('modal');
    const box = document.getElementById('modalContent');
    const recs = (m.charIndex[name] || []).slice().sort((a, b) => b.start.localeCompare(a.start));
    const f = m.firstSeen[name];
    const pr = assetOf(gid, name).portrait;
    box.innerHTML = `
      <div class="modal-head">
        ${avaHTML(name, 46, gid)}
        <div>
          <div class="modal-name">${esc(name)}
            ${f ? `<span class="tag ${f.rarity === 5 ? 'five' : 'four'}">${f.rarity}★</span>` : ''}
          </div>
          <div class="muted">${esc(m.game.name)} · ${f ? `首次登场：${esc(f.phase)}（${f.date}）` : '登场时间未知'}</div>
        </div>
      </div>
      ${pr ? `<img class="portrait" src="${pr}" alt="${esc(name)} 立绘">`
           : `<div class="muted" style="padding:18px 0">暂无立绘图片（${esc(m.game.name)}的立绘需运行 fetch_assets.py 补齐）</div>`}
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

  // ---------- 渲染：当前版本 / 倒计时 ----------
  function renderCurrentVersion() {
    if (isAll()) { renderAllVersions(); return; }
    const box = document.getElementById('currentVersion');
    const g = M.game;
    if (M.R.MILESTONE_ONLY) {
      const lm = (g.milestones || []).find((x) => x.type === 'launch');
      const launch = parse(lm ? lm.date : g.versions[0].start);
      const left = Math.round((launch - today()) / DAY);
      const passed = left < 0;
      box.innerHTML = `
        <div class="v-name">${esc(g.name)} ${passed ? '已公测' : '未公测'}</div>
        <div class="v-title">${passed ? '星球生活模拟 · 已上线' : `距公测 ${left} 天`}</div>
        <div class="v-range">公测日 ${fmt(launch)}（PC / iOS / Android）</div>
        <div class="v-progress"><i style="width:${passed ? 100 : Math.max(2, 100 - Math.min(100, left))}%"></i></div>`;
      return;
    }
    const c = currentVersionOf(M);
    if (!c) { box.innerHTML = '<span class="muted">暂无数据</span>'; return; }
    box.innerHTML = `
      <div class="v-name">${c.v.version} ${c.v.predicted ? '<span class="tag predicted">预测</span>' : ''}</div>
      <div class="v-title">${/^（/.test(c.v.title || '') || !c.v.title ? '<span class="muted">版本主题待补充</span>' : esc(c.v.title)}</div>
      <div class="v-range">${c.v.start} ~ ${c.end ? fmt(c.end) : '—'}（第 ${c.day} / ${M.R.VERSION_DAYS} 天）</div>
      <div class="v-progress"><i style="width:${c.pct.toFixed(1)}%"></i></div>`;
  }

  // 总览：四款游戏的版本进度一览
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
      const c = currentVersionOf(m);
      if (!c) return '';
      return `<div class="gv-row" style="--gc:${g.accent || '#999'}" title="点击查看《${esc(g.name)}》" data-goto="${g.id}">
        <div class="gv-head"><b class="gn">${esc(g.short || g.name)}</b>
          <span class="gv">${esc(c.v.version)}</span>
          <em>第 ${c.day}/${m.R.VERSION_DAYS} 天${c.v.predicted ? ' · 预测' : ''}</em>
        </div>
        <div class="gv-bar"><i style="width:${c.pct.toFixed(1)}%"></i></div>
      </div>`;
    }).join('');
    box.querySelectorAll('[data-goto]').forEach((el) => { el.onclick = () => selectGame(el.dataset.goto); });
  }

  // ---------- 图例 / 说明 / 数据源 ----------
  const TYPE_LABEL = {
    update: '版本更新', launch: '公测上线', phase1: '上半', phase2: '下半',
    live: '前瞻直播', splash: '立绘/角色介绍', pv: '版本PV/角色PV/演示',
    code: '兑换码过期', event: '活动/里程碑',
  };

  function renderLegend() {
    const box = document.getElementById('legend');
    if (isAll()) {
      box.innerHTML = GAMES.map((g) => `<span><i class="dot" style="background:${g.accent}"></i>${esc(g.short || g.name)}</span>`).join('')
        + '<span class="lg-note">色块＝游戏 · 文字＝事件类型</span>';
      return;
    }
    const used = new Set(M.events.map((e) => e.type));
    box.innerHTML = Object.keys(TYPE_LABEL).filter((t) => used.has(t)).map((t) => {
      let label = TYPE_LABEL[t];
      if (t === 'phase1' || t === 'phase2') label += M.R.PHASE_WORD;
      return `<span><i class="dot ${t}"></i>${label}</span>`;
    }).join('');
  }

  function renderHelp() {
    const g = M.game;
    const R = M.R;
    const li = [];
    if (isAll()) {
      const verCount = GAMES.reduce((n, x) => n + modelOf(x.id).versions.length, 0);
      const banCount = GAMES.reduce((n, x) => n + modelOf(x.id).banners.length, 0);
      li.push('当前是 <b>四游戏总览</b>：一张日历里同时显示原神 / 星铁 / 绝区零 / 星布谷地的版本更新、卡池开启、前瞻、立绘 PV 与里程碑。');
      li.push(`每格按游戏分组，一行一款游戏：左侧色块是游戏（${GAMES.map((x) => (x.short || x.name).slice(0, 1)).join(' / ')}），后面是事件类型与摘要；当天该游戏有多条时折叠成 <b>+N</b>，点格子看全部。`);
      li.push(`格子顶部每款游戏一条细色带：深色＝上半，浅色＝下半/额外，空白＝当天无在售。`);
      li.push(`已收录 ${verCount} 个版本、${banCount} 期卡池/跃迁/频段；标 <span class="tag predicted">预测</span> 的为按 6 周版本的规律推算。`);
      li.push('侧栏「未来提醒 / 各游戏在售 / 角色查询 / 各游戏版本」已合并显示，点击卡片或角色头像可看详情；想只看一款游戏，点上方标签切换。');
      li.push('运行 <code>update_data.py</code> 刷新数据；<code>fetch_assets.py</code> 补充头像立绘。');
      document.getElementById('helpList').innerHTML = li.map((x) => `<li>${x}</li>`).join('');
      document.getElementById('footSources').innerHTML =
        '数据源：' + GAMES.map((x) => `<a href="https://wiki.biligame.com/${x.wiki || 'ys'}/" target="_blank">${esc(x.short || x.name)} Wiki</a>`).join(' / ')
        + ` · 数据生成于 ${esc(GENERATED)} · 未来事件为规律推算，实际以米哈游官方公告为准`;
      return;
    }
    if (M.R.MILESTONE_ONLY) {
      li.push(`《${esc(g.name)}》尚未进入版本周期，日历只收录官方公布的里程碑（前瞻、公测、活动截止、兑换码有效期）。`);
      li.push(`${esc(R.CYCLE_NOTE)}`);
    } else {
      const span = M.versions.length ? `${M.versions[0].start} 至今` : '';
      li.push(`可前后翻页查看 ${span} 的历史版本、${esc(g.rules && g.rules.PHASE_WORD === '卡池' ? '卡池' : '卡池/跃迁/频段')}阵容与未来约一年的预测。`);
      li.push(`<b>版本时间与${esc(R.PHASE_WORD)}阵容</b>来自 Wiki 真实资料（${M.banners.length} 期 / ${M.versions.filter((v) => !v.predicted).length} 个版本）；标 <span class="tag predicted">预测</span> 的为规律推算。`);
      li.push(`${esc(R.CYCLE_NOTE)}；前瞻直播 ≈ 更新前 12 天（${esc(R.LIVE_TIME || '晚上')}），兑换码 ${esc(R.CODE_NOTE || '以官方公告为准')}。`);
      li.push(R.CALIBRATED
        ? '发布节奏已按 <a href="https://space.bilibili.com/401742377/dynamic" target="_blank">B 站官方空间</a> 2026-07~11 动态逐条校准（立绘 ≈ U-8、角色PV ≈ U-7~-6、演示 ≈ U-2~-1）。'
        : `《${esc(g.name)}》的角色 PV / 立绘日期尚未逐条校准，仅按官号惯例估算，实际可能 ±2 天；版本与${esc(R.PHASE_WORD)}起止为真实数据。`);
    }
    li.push('运行 <code>update_data.py</code> 刷新四个游戏的版本与卡池数据；<code>fetch_assets.py</code> 补充角色头像立绘（目前覆盖原神与星铁）。');
    li.push('格子顶部色条表示卡池进行中（红＝上半，紫＝下半/额外）；右上角提醒需保持本页标签开着（可右键固定标签页）。');
    document.getElementById('helpList').innerHTML = li.map((x) => `<li>${x}</li>`).join('');

    document.getElementById('footSources').innerHTML =
      (g.sources || []).map((s) => `<a href="${s.url}" target="_blank">${esc(s.label)}</a>`).join(' / ')
      + ` · 数据生成于 ${esc(GENERATED)} · 未来事件为规律推算，实际以米哈游官方公告为准`;
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
        ? soon.slice(0, 6).map((e) => `${e.date === fmt(t) ? '[今天] ' : e.date + ' '}${e.gshort ? '[' + e.gshort + '] ' : ''}${e.title}`).join('\n')
        : `未来 3 天没有${isAll() ? '米哈游游戏' : M.game.name}事件`;
      new Notification(isAll() ? '米哈游游戏日历' : `${M.game.name}日历`, { body });
    };
    if (window.Notification && Notification.permission === 'granted') btn.textContent = '🔔 提醒已开启';
  }

  // ---------- 切游戏 ----------
  function selectGame(gid) {
    if (gid === 'all') gid = ALL_GID;
    GID = gid;
    try { localStorage.setItem('mihoyo-cal-game', gid); } catch (e) { /* ignore */ }
    M = modelOf(gid);
    const all = isAll();
    const g = M.game;
    document.documentElement.style.setProperty('--accent', g.accent || '#c8a45c');
    document.getElementById('appTitle').textContent = all ? '米哈游游戏日历' : `${g.name}日历`;
    document.getElementById('appSub').textContent = all
      ? '四款游戏合并总览 · 一张日历看全部版本 / 卡池 / 前瞻 · 点标签看单游戏详情'
      : `${g.tagline || ''} · 历史事件 · 卡池阵容 · 未来预测 · 到期提醒`;
    document.title = all ? '米哈游游戏日历 · 原神 / 星铁 / 绝区零 / 星布谷地' : `${g.name}日历 · ${g.tagline || '米哈游游戏时间线'}`;

    const lastB = M.banners[M.banners.length - 1];
    const demo = lastB && lastB.character && lastB.character.length && lastB.character[0].five.length
      ? lastB.character.map((c) => c.five[0]).slice(0, 2).join(' / ') : '';
    const searchEl0 = document.getElementById('charSearch');
    if (searchEl0) searchEl0.placeholder = all ? '输入角色名，如：芙宁娜 / 黄泉（跨四游戏）' : (demo ? `输入角色名，如：${demo}` : '输入角色名');

    const hideChars = all ? false : !Object.keys(M.charIndex).length;
    document.getElementById('charCard').classList.toggle('hidden', hideChars);
    document.getElementById('currentBannerCard').classList.toggle('hidden', !all && !!M.R.MILESTONE_ONLY);
    document.getElementById('bannerCardTitle').textContent = all ? '🎴 各游戏在售' : '🎴 当前 UP';
    document.getElementById('versionCardTitle').textContent = all ? '⏳ 各游戏版本' : '⏳ 当前版本';
    document.getElementById('charCardTitle').textContent = all ? '🔍 角色 UP 查询（全游戏）' : '🔍 角色 UP 查询';

    renderTabs();
    renderLegend();
    renderHelp();
    renderCalendar();
    renderUpcoming();
    renderCurrentBanner();
    renderCurrentVersion();
    if (!hideChars) {
      const el = document.getElementById('charSearch');
      renderCharSearch(el ? el.value : '');
    }
    showDayDetail(fmt(today()));
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
  selectGame(GID);
})();
