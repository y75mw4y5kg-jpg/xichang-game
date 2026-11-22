(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const pick = items => items[Math.floor(Math.random() * items.length)];
  const clamp = (n, max) => Math.max(0, Math.min(max, n));
  const KEY = "xichang_save_v1";
  const SOUND_KEY = "xichang_sound_v1";
  const MUSIC_KEY = "xichang_music_v1";
  let muted = false, musicEnabled = true;
  const gates = {camp: 1, map: 2, prison: 3, dossier: 5};
  const places = [
    ["皇城", 52, 18], ["内阁", 73, 39], ["西市", 22, 61],
    ["城门", 51, 84], ["锦衣卫", 76, 66]
  ];
  const traits = ["刑讯老手", "京城地头蛇", "死忠"];
  const buildings = {
    hall: ["西厂大堂", 400, 1000], jail: ["诏狱", 300], archive: ["密档阁", 300]
  };
  const merchant = "p_salt_merchant";
  const clerk = "p_hubu_clerk";
  const coreEvidence = "d_hubu_minister";
  const minister = "p_hubu_minister";
  let intro, events, people, evidence, s, view, adBusy = false, storageWarning = "";
  const maxAp = () => s.crew.length;
  const tortureDamage = () => s.crew.includes("刑讯老手") ? 25 : 35;
  const capacity = () => 1 + 2 * s.hall;
  const jailCap = () => 2 * s.jail - 1;
  const cardCap = () => 3 * s.archive;
  const ordinaryCards = () => s.cards.filter(id => id !== coreEvidence).length;
  const fee = () => s.crew.includes("京城地头蛇") ? 5 : 10;

  function fresh() {
    return {
      turn: 1, phase: "intro", frame: 0, favor: 50, dread: 20, silver: 500, intel: 10,
      ap: 0, crew: [], hall: 1, jail: 1, archive: 1, jobs: [], inmates: [], cards: [],
      leads: [], captured: [], defeated: [], spies: 0, broke: 0, questioned: false,
      report: "", event: null, recentEvents: [], ending: "", note: ""
    };
  }

  function node(tag, cls, label) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (label != null) n.textContent = label;
    return n;
  }
  function button(label, action, cls = "btn-primary", disabled = false) {
    const b = node("button", cls, label);
    b.type = "button";
    b.disabled = disabled;
    b.onclick = action;
    return b;
  }
  function animate(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }
  // Frequencies and short envelopes distinguish wood, metal and low percussion.
  const sound = (() => {
    const Audio = window.AudioContext || window.webkitAudioContext;
    let context, pendingCue, actionSound, clickedButton;
    const voices = {
      click(tone) {
        tone("triangle", 930, 570, 0.045, 0.09);
        tone("sine", 1480, 1070, 0.022, 0.035);
      },
      stamp(tone) {
        tone("sine", 165, 42, 0.24, 0.31);
        tone("triangle", 275, 75, 0.07, 0.10);
      },
      coin(tone) {
        tone("sine", 1780, 1755, 0.18, 0.08);
        tone("sine", 2890, 2870, 0.10, 0.04);
        tone("sine", 2290, 2240, 0.22, 0.07, 0.065);
      },
      hit(tone) {
        tone("sawtooth", 670, 100, 0.035, 0.08);
        tone("triangle", 185, 68, 0.11, 0.19, 0.018);
      },
      heartbeat(tone) {
        tone("sine", 108, 52, 0.18, 0.26);
        tone("sine", 92, 48, 0.15, 0.19, 0.23);
      },
      alert(tone) {
        tone("sine", 157, 148, 1.05, 0.20);
        tone("sine", 239, 232, 0.84, 0.10);
        tone("triangle", 414, 392, 0.50, 0.045);
      }
    };

    function play(name) {
      if (muted || !Audio) return;
      if (!context) {
        // Page entry can precede the first gesture. Keep only the current scene's cue.
        pendingCue = name;
        return;
      }
      actionSound = true;
      const ctx = context;
      const now = ctx.currentTime;
      voices[name]((wave, from, to, duration, volume, delay = 0) => {
        const start = now + delay;
        const end = start + duration;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = wave;
        osc.frequency.setValueAtTime(from, start);
        osc.frequency.exponentialRampToValueAtTime(to, end);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(volume, start + 0.004);
        gain.gain.exponentialRampToValueAtTime(0.0001, end);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.onended = () => { osc.disconnect(); gain.disconnect(); };
        osc.start(start);
        osc.stop(end);
      });
    }

    function unlock() {
      if (muted || !Audio) return;
      try {
        const needsContext = !context || context.state === "closed";
        if (needsContext) context = new Audio();
        if (needsContext || context.state !== "running") context.resume().catch(() => {});
        if (pendingCue) {
          play(pendingCue);
          pendingCue = null;
        }
      } catch { /* The game also runs when browser audio is unavailable. */ }
    }

    function silence() {
      pendingCue = null;
      if (context) context.close().catch(() => {});
      context = null;
    }

    function bind() {
      // touchend covers mobile Safari. Click also covers keyboard-activated buttons.
      document.addEventListener("touchend", unlock, {capture: true, passive: true});
      document.addEventListener("click", event => {
        clickedButton = event.target.closest("button:enabled");
        actionSound = false;
        unlock();
      }, true);
      document.addEventListener("click", () => {
        if (!actionSound && clickedButton && clickedButton.id !== "settings-sound") play("click");
        clickedButton = null;
      });
    }
    return {play, unlock, silence, bind};
  })();

  const music = (() => {
    const scale = [110, 123.47, 138.59, 164.81, 185]; // A, B, C#, E, F#
    let ctx, output, drone, recording, timer, activated = false;

    function pluck() {
      const now = ctx.currentTime;
      const hz = pick(scale);
      for (const [partial, amplitude] of [[1, 0.16], [2, 0.055], [3, 0.025]]) {
        const osc = ctx.createOscillator();
        const envelope = ctx.createGain();
        osc.frequency.value = hz * partial;
        envelope.gain.setValueAtTime(0.0001, now);
        envelope.gain.exponentialRampToValueAtTime(amplitude, now + 0.018);
        const end = now + 2.2 / Math.sqrt(partial);
        envelope.gain.exponentialRampToValueAtTime(0.0001, end);
        osc.connect(envelope).connect(output);
        osc.onended = () => { osc.disconnect(); envelope.disconnect(); };
        osc.start(now);
        osc.stop(end);
      }
    }

    function schedule() {
      clearTimeout(timer);
      timer = null;
      if (!musicEnabled || document.hidden || recording || ctx.state !== "running") return;
      timer = setTimeout(() => {
        pluck();
        schedule();
      }, 2000 + Math.random() * 2000);
    }

    async function loadRecording() {
      try {
        const response = await fetch("./assets/bgm.mp3");
        if (!response.ok) return;
        const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
        recording = ctx.createBufferSource();
        recording.buffer = buffer;
        recording.loop = true;
        const level = ctx.createGain();
        level.gain.value = 0.19;
        recording.connect(level).connect(output);
        recording.start();
        drone.stop();
        schedule();
      } catch { /* The synthesized score continues if the optional file cannot be decoded. */ }
    }

    function sync() {
      const active = activated && musicEnabled && !document.hidden;
      if (!active) {
        clearTimeout(timer);
        timer = null;
        if (ctx) ctx.suspend().catch(() => {});
        return;
      }
      try {
        if (!ctx) {
          const Audio = window.AudioContext || window.webkitAudioContext;
          if (!Audio) return;
          ctx = new Audio();
          output = ctx.createGain();
          output.gain.value = 0.30;
          output.connect(ctx.destination);
          drone = ctx.createOscillator();
          const bed = ctx.createGain();
          bed.gain.setValueAtTime(0, ctx.currentTime);
          bed.gain.linearRampToValueAtTime(0.055, ctx.currentTime + 1.4);
          drone.frequency.value = 55;
          drone.connect(bed).connect(output);
          drone.start();
          ctx.onstatechange = schedule;
          loadRecording();
        }
        ctx.resume().then(() => { if (!timer) schedule(); }).catch(() => {});
      } catch { /* Audio support is optional. */ }
    }

    function bind() {
      const gesture = () => {
        activated = true;
        if (!ctx || ctx.state !== "running") sync();
      };
      document.addEventListener("touchend", gesture, {capture: true, passive: true});
      document.addEventListener("click", gesture, true);
      document.addEventListener("visibilitychange", sync);
    }
    return {bind, sync};
  })();

  function stamp(word) {
    sound.play("stamp");
    $("global-stamp").textContent = word;
    animate($("global-stamp"), "slam");
    animate($("game-shell"), "shake");
  }
  function delta(box, amount) {
    if (!amount) return;
    const el = node("span", "stat-delta " + (amount > 0 ? "up" : "down"),
      (amount > 0 ? "+" : "") + amount);
    box.append(el);
    setTimeout(() => el.remove(), 1000);
  }
  function effect(changes) {
    for (const [key, amount] of Object.entries(changes)) {
      const before = s[key];
      s[key] = clamp(before + amount, key === "silver" ? Infinity : 100);
      if (key === "silver" && s[key] !== before) sound.play("coin");
      delta($("box-" + key), s[key] - before);
    }
  }
  function finish(word) {
    if ((!s.favor && s.phase !== "rescue") || !s.dread || s.ending) {
      s.ending ||= !s.favor ? "圣心已失，午门斩首" : "沦为笑柄，西厂裁撤";
      if (s.phase !== "ending") sound.play("alert");
      s.phase = "ending";
    }
    try { saveProgress(); }
    catch { storageWarning = "浏览器存储不可用，本局进度只能保留到关闭页面。"; }
    render();
    if (word) stamp(word);
  }

  function makeJobs() {
    if (s.turn === 2) return [{place: 2, kind: "capture", target: merchant}];
    const locations = places.map((_, i) => i);
    const count = pick([2, 3]);
    const jobs = [];
    const lead = nextTarget();
    for (let i = 0; i < count; i++) {
      const place = locations.splice(Math.floor(Math.random() * locations.length), 1)[0];
      let kind = pick(["silver", "intel"]);
      if (Math.random() < (15 + s.intel / 2) / 100) kind = "card";
      if (i === 0 && lead) jobs.push({place, kind: "capture", target: lead});
      else jobs.push({place, kind});
    }
    return jobs;
  }
  function nextTarget() {
    // A dead or dismissed lead can be arrested again if its successor is still locked.
    const target = s.leads.includes(minister) ? minister : s.leads.includes(clerk) ? clerk : merchant;
    if ((target === minister && s.captured.includes(minister) && s.cards.includes(coreEvidence)) ||
        s.inmates.some(p => p.id === target)) return null;
    return target;
  }
  function unlockLead(id) {
    if (s.leads.includes(id)) return;
    s.leads.push(id);
    offerTarget(id);
  }
  function offerTarget(id) {
    if (!id || s.jobs.some(job => job.target === id)) return;
    const spare = places.findIndex((_, place) => !s.jobs.some(job => job.place === place));
    if (spare >= 0) s.jobs.push({place: spare, kind: "capture", target: id});
  }
  function finishKpi() {
    if (!s.defeated.includes(minister)) s.defeated.push(minister);
    s.ending = "奉旨提督，权倾朝野";
  }

  function jobName(job) {
    const kind = job.assignment || job.kind;
    return kind === "capture" ? "缉拿" + (job.target === minister ? "户部侍郎" :
      people[job.target].title + people[job.target].name) :
      {silver: "查缉走私", intel: "探听密会", card: "搜查暗账"}[kind];
  }
  function storeCard(id) {
    const title = evidence[id].title;
    if (s.cards.includes(id)) {
      effect({silver: 50, intel: 5});
      return title + "已在密档，折为银两 +50、情报 +5。";
    }
    if (id !== coreEvidence && ordinaryCards() >= cardCap()) {
      effect({intel: 10});
      return "密档已满，转录" + title + "摘要，情报 +10。";
    }
    s.cards.push(id);
    return "缴获" + title + "。";
  }
  function settle(job) {
    const kind = job.assignment || job.kind;
    if (kind === "capture") {
      const p = people[job.target];
      if (s.inmates.some(inmate => inmate.id === p.id)) return p.name + "已在押。";
      if (s.inmates.length >= jailCap()) return "牢房已满，目标暂缓收押。";
      s.inmates.push({id: p.id, defense: p.defense, health: p.health,
        compliance: p.compliance, last: 0});
      if (!s.captured.includes(p.id)) s.captured.push(p.id);
      return p.name + "已收押诏狱。";
    }
    if (kind === "card") return storeCard("d_hubu_clerk");
    if (kind === "silver") {
      const amount = pick([50, 70, 90]);
      effect({silver: amount});
      return "截获赃银 " + amount + " 两。";
    }
    effect({intel: 10});
    return "带回情报 +10。";
  }
  function endBlockReason() {
    if (s.turn === 1 && !s.crew.length) return "请先招募一队番子";
    if (s.turn === 2 && !s.jobs.some(j => j.sent)) return "请先派驻西市缉拿盐商";
    if (s.turn === 3 && !s.questioned) return "请先在诏狱审讯盐商";
    return "";
  }
  function endTurn() {
    if (s.phase !== "play" || endBlockReason()) return;
    const lines = s.jobs.filter(j => j.sent).map(j => places[j.place][0] + "：" + settle(j));
    if (s.spies) {
      effect({intel: 5 * s.spies});
      lines.push("朝中暗桩送回情报。");
    }
    s.report = lines.join(" ") || "本旬无外派差事。";
    s.event = null;
    if (s.turn >= 4) {
      const eligible = events.filter(event => !s.recentEvents.includes(event.id));
      s.event = pick(eligible.length ? eligible : events).id;
      s.recentEvents = [...s.recentEvents, s.event].slice(-3);
    }
    s.phase = "report";
    finish("封卷");
  }
  function nextTurn(word) {
    s.broke = s.silver === 0 ? s.broke + 1 : 0;
    if (s.turn === 15 && !s.defeated.includes(minister)) effect({favor: -s.favor});
    if (s.broke >= 2) s.ending = "饷银断绝，番役兵变";
    if (s.favor && s.dread && !s.ending) {
      s.turn++;
      if (s.turn === 6 || s.turn === 15) sound.play("alert");
      s.ap = maxAp();
      s.jobs = makeJobs();
      s.note = "";
      s.phase = "play";
      view = "camp";
    }
    finish(word);
  }

  function modal(id) {
    $("btn-settings").disabled = Boolean(id) || s.phase !== "play";
    for (const el of document.querySelectorAll(".modal-backdrop"))
      el.classList.toggle("open", el.id === id);
    $("game-shell").querySelector(".stage-container").inert = Boolean(id) || s.phase === "intro";
    document.querySelector(".bottom-nav").inert = Boolean(id) || s.phase === "intro";
  }
  function effectsText(effects) {
    const labels = {favor: "圣眷", dread: "威慑", silver: "银两", intel: "情报"};
    return Object.entries(effects).map(([key, value]) =>
      labels[key] + (value > 0 ? "+" : "") + value).join(" · ");
  }
  function addPreview(button, text) {
    button.append(node("small", "action-preview", text));
    return button;
  }
  function choices(tag, title, desc, options) {
    $("event-tag").textContent = tag;
    $("event-title").textContent = title;
    $("event-desc").textContent = desc;
    $("event-trump-btn").style.display = "none";
    $("event-choices").replaceChildren(...options.map(([seal, label, action, disabled, preview]) => {
      const b = button("", action, "choice-btn", disabled);
      const copy = node("span", "", label);
      copy.append(node("small", "action-preview", preview || "返回前一界面"));
      b.append(node("span", "seal-badge", seal), copy);
      return b;
    }));
    modal("modal-event");
  }
  const adNames = {rescue_prisoner: "太医赶赴诏狱", emergency_fund: "调拨厂公私房银",
    double_loot: "严查密室暗格", instant_upgrade: "工部连夜督办"};
  window.triggerRewardedAd = function(type, onSuccess) {
    if (adBusy) return;
    adBusy = true;
    modal("modal-ad");
    $("ad-title").textContent = adNames[type];
    let left = 3;
    const tick = () => { $("ad-countdown").textContent = "模拟观看激励广告 · 剩余 " + left + " 秒"; };
    tick();
    const timer = setInterval(() => {
      if (--left) return tick();
      clearInterval(timer);
      adBusy = false;
      render();
      onSuccess();
    }, 1000);
  };
  function fund() {
    window.triggerRewardedAd("emergency_fund", () => { effect({silver: 200}); finish("拨银"); });
  }
  function shortFunds() {
    choices("库银告急", "银两不足", "可调拨厂公私房银 200 两。", [
      ["调", "看广告领银", fund, false, "银两+200"], ["退", "返回", render]
    ]);
  }
  function recruit() {
    if (maxAp() >= capacity()) return;
    if (s.silver < 100) return shortFunds();
    effect({silver: -100});
    const trait = pick(traits);
    s.crew.push(trait);
    s.ap++;
    s.note = "新番子入署，词条【" + trait + "】。";
    finish("录用");
  }
  function upgrade(key) {
    const [name, ...costs] = buildings[key];
    const cost = costs[s[key] - 1];
    function buy(price) {
      effect({silver: -price});
      s[key]++;
      s.note = name + "已升至 Lv." + s[key] + "。";
      finish("准建");
    }
    choices("营造", name + "升至 Lv." + (s[key] + 1), "工料银 " + cost + " 两。", [
      ["准", "照价拨款", () => s.silver >= cost ? buy(cost) : shortFunds(), false, "银两-" + cost + " · 等级+1"],
      ["督", "看广告半价督办 · " + cost / 2 + " 两", () => s.silver >= cost / 2 ?
        window.triggerRewardedAd("instant_upgrade", () => buy(cost / 2)) : shortFunds(), false,
        "银两-" + cost / 2 + " · 等级+1"],
      ["退", "返回", render]
    ]);
  }
  const locationDescriptions = [
    "宫漏三响，值门内侍提灯换班。廊下的靴印一直通到封着火漆的匣子前。",
    "票拟的墨迹尚湿，帘后传出卷宗合拢的轻响。书吏独独漏收了一张字条。",
    "鱼鳞般的棚顶挤在雨里。卖盐的收了幌子，秤盘底下还粘着一粒白霜。",
    "暮鼓催着关城。车轴碾过湿泥，守卒把最后一张路引翻来覆去地看。",
    "卫所石阶被靴底磨亮。檐下的缇骑都盯着案上的腰牌，谁也不先开口。"
  ];

  function openLocation(place) {
    const job = s.jobs.find(j => j.place === place);
    const name = places[place][0];
    const tutorial = s.turn === 2;
    const full = s.inmates.length >= jailCap();
    $("location-name").textContent = name;
    $("location-desc").textContent = locationDescriptions[place];
    $("location-status").textContent = job && job.sent ? "番子潜伏中，正在" + jobName(job) + "，旬末回禀。" :
      [job ? "线报：" + jobName(job) : "此处尚无线报，可自行探查。",
        tutorial ? "初差须赴西市布控缉拿钱万贯。" : "",
        !s.ap ? "本旬行动点已用尽。" : "",
        job && job.target && full ? "诏狱已满，请先腾出牢房。" : ""].filter(Boolean).join(" ");
    const actions = $("location-actions");
    actions.replaceChildren();
    function option(label, kind, reward, locked = false) {
      const capture = kind === "capture";
      const disabled = Boolean(job && job.sent) || !s.ap || locked || (tutorial && !capture);
      const action = button(label, () => {
        if (disabled || s.phase !== "play" || !s.ap || (job && job.sent)) return;
        if (s.silver < fee()) return shortFunds();
        const order = job || {place, kind};
        if (!job) s.jobs.push(order);
        order.assignment = kind;
        order.sent = true;
        s.ap--;
        effect({silver: -fee()});
        finish("派驻");
        openLocation(place);
      }, capture ? "choice-btn location-capture" : "choice-btn", disabled);
      actions.append(addPreview(action, "1 行动点 · " + fee() + " 两｜旬末" + reward));
    }
    if (job && job.target) option("布控缉拿 · " + people[job.target].name, "capture", "收押" + people[job.target].title, full);
    const ledger = job && job.kind === "card";
    option("暗访打探", ledger ? "card" : "intel", ledger ? "缴获盐引账（重复折银与情报）" : "情报+10");
    option("搜刮查抄", "silver", "得银50～90两");
    modal("modal-location");
    $("location-leave").focus();
    $("location-leave").onclick = () => {
      render();
      $("map-pins-container").children[place].focus();
    };
  }

  function interrogate(p, method) {
    if (p.last === s.turn || !p.defense || !p.health) return;
    if (method === "threat" && s.dread < 40) return;
    if (method === "bribe" && s.silver < 30) return shortFunds();
    const source = people[p.id];
    p.last = s.turn;
    s.questioned = true;
    if (method === "torture") {
      sound.play("hit");
      p.defense -= 35;
      p.health -= tortureDamage();
    } else if (method === "threat") {
      p.defense -= 20;
    } else {
      effect({silver: -30});
      p.defense -= 15;
      p.compliance = clamp(p.compliance + 25, 100);
      p.health = clamp(p.health + 10, 100);
    }
    p.defense = Math.max(0, p.defense);
    p.health = Math.max(0, p.health);
    if (!p.health) {
      effect({favor: -20});
      s.phase = "rescue";
    }
    if (!p.defense && p.health && p.id === merchant) unlockLead(source.next_target_id);
    finish("审");
    if (method === "torture") animate($("prison-container").querySelectorAll(".prisoner-card")[s.inmates.indexOf(p)]
      .querySelector("img"), "hit");
  }
  function dispose(p, action, multiplier = 1) {
    const src = people[p.id];
    if (p.id === clerk && action !== "loot" && !s.leads.includes(minister)) return;
    if (action === "impeach") {
      effect({favor: 20});
      finishKpi();
    } else if (action === "loot") {
      effect({silver: src.loot_silver * multiplier});
      if (p.id === clerk) unlockLead(src.next_target_id);
    } else if (action === "spy") s.spies++;
    else effect({favor: 15, dread: 10});
    if (src.unlocks_dossier) s.note = storeCard(src.unlocks_dossier.id);
    s.inmates.splice(s.inmates.indexOf(p), 1);
    finish({loot: "抄家", spy: "留用", credit: "请功", impeach: "弹劾"}[action]);
  }
  function loot(p) {
    const amount = people[p.id].loot_silver;
    const cue = p.id === clerk ? " · 《军饷密账》与侍郎线索" :
      p.id === merchant ? " · 缴获盐引账" : "";
    choices("结案", "查抄家产", "账上计银 " + amount + " 两。", [
      ["抄", "收缴入库", () => dispose(p, "loot"), false, "银两+" + amount + cue],
      ["查", "看广告严查暗格", () => window.triggerRewardedAd("double_loot", () => dispose(p, "loot", 2)),
        false, "银两+" + amount * 2 + cue],
      ["退", "返回", render]
    ]);
  }

  function mainQuest() {
    if (s.captured.includes(minister) && !nextTarget()) {
      return s.cards.includes(coreEvidence) ? "密档可凭《军饷密账》直接弹劾，或审破侍郎防线后凭口供弹劾。" :
        "审破侍郎防线后，凭口供御前弹劾。";
    }
    if (s.leads.includes(minister)) return "赴京城派驻【缉拿户部侍郎】，旬末收押。";
    if (s.inmates.some(p => p.id === clerk)) return "审破周文礼防线并抄家，必得《军饷密账》。";
    if (s.leads.includes(clerk)) return "赴京城派驻【缉拿户部主事周文礼】，旬末收押。";
    if (s.inmates.some(p => p.id === merchant)) return "审破钱万贯防线，查出周文礼，再处置钱万贯腾出牢房。";
    return "去京城缉拿私盐商钱万贯，再回营结旬。";
  }

  function renderCamp() {
    $("camp-bg-img").setAttribute("src", "./assets/camp_lv" + Math.min(2, s.hall) + ".jpg");
    $("camp-level-name").textContent = "西厂 · " + ["破败空宅", "肃杀厂署", "权倾朝野"][s.hall - 1] + " (Lv." + s.hall + ")";
    $("camp-capacity-text").textContent = "番子编制：" + maxAp() + " / " + capacity() + " 队";
    let hint = mainQuest();
    const assigned = s.jobs.find(j => j.sent && (j.assignment || j.kind) === "capture");
    const lead = s.jobs.find(j => j.target === nextTarget());
    if (lead && !lead.sent) hint = places[lead.place][0] + "传来线报。" + hint;
    if (assigned) hint = "缉拿" + people[assigned.target].name + "的人已经出门，回营结旬听报吧。";
    if (s.turn === 1) hint = s.crew.length ? "名册有了人，结旬后随我去西市。" : "空衙门办不了案。拨一百两招一队番子，便有一点行动力。";
    if (s.turn === 4) hint = "今日起，旬末还有御前奏折等你落印。" + hint;
    if (s.turn === 5) hint = "密档阁已开，营中也能动工扩建了。" + hint;
    if (s.turn >= 6) hint = "御限连今日还余" + (16 - s.turn) + "旬。" + hint;
    if (s.favor < 30) hint = "御前已有人问起你的差事。少伸手索银，奏折里拣能挽回圣眷的办。" + hint;
    const roster = [...new Set(s.crew)];
    if (s.note.startsWith("新番子入署")) roster.splice(roster.indexOf(s.crew[s.crew.length - 1]), 1);
    $("camp-thought").textContent = [storageWarning, s.note, hint,
      roster.length ? "已招募词条：" + roster.join(" · ") : ""].filter(Boolean).join(" ");
    $("btn-recruit").disabled = maxAp() >= capacity();
    $("btn-recruit").textContent = s.turn === 1 && !s.crew.length ? "招募首队 ◂" : "招募";
    const blocked = endBlockReason();
    $("btn-end-turn").disabled = Boolean(blocked);
    $("btn-end-turn").textContent = blocked || (s.turn >= 4 ? "结束本旬 · 批阅奏折" : "结束本旬");
    const list = $("building-list");
    list.replaceChildren();
    if (s.turn >= 5) for (const [key, [name, ...costs]] of Object.entries(buildings)) {
      const card = node("div", "action-card");
      const info = node("div");
      const cost = costs[s[key] - 1];
      info.append(node("div", "action-card-title", name + " Lv." + s[key]),
        node("div", "action-card-meta", cost ? "升级耗银 " + cost + " 两" : "已达最高级"));
      card.append(info, button("升级", () => upgrade(key), "btn-primary", !cost));
      list.append(card);
    }
    if (s.silver < 100) list.append(button("看广告调拨私房银 +200", fund));
  }
  function renderMap() {
    $("map-pins-container").replaceChildren(...places.map(([name, x, y], i) => {
      const j = s.jobs.find(job => job.place === i);
      const active = j && !j.sent;
      const b = button(name, () => openLocation(i), "map-pin" + (active ? " has-event" : ""));
      b.style.left = x + "%";
      b.style.top = y + "%";
      if (active) b.prepend(node("span", "pin-dot"));
      return b;
    }));
    $("map-dispatch-summary").textContent = "点地名察看线报，选定差事才派驻。 " +
      s.jobs.map(j => places[j.place][0] + " · " + jobName(j) + (j.sent ? "（已派驻）" : "")).join("；") +
      " " + mainQuest();
  }
  function renderPrison() {
    const list = $("prison-container");
    list.replaceChildren();
    list.append(node("div", "map-log-box", [s.note, mainQuest()].filter(Boolean).join(" ")));
    if (!s.inmates.length) list.append(node("div", "map-log-box", "诏狱空无一人，可在京城派驻抓捕目标。"));
    for (const p of s.inmates) {
      const src = people[p.id];
      const card = node("div", "prisoner-card");
      const header = node("div", "prisoner-header");
      const portrait = node("img", "prisoner-avatar");
      portrait.src = src.avatar;
      portrait.alt = src.name;
      const bio = node("div");
      bio.append(node("div", "prisoner-name", src.name), node("div", "prisoner-title", src.title),
        node("div", "prisoner-quote", src.testimony[p.defense > 60 ? "defiant" : p.defense > 30 ? "wavering" : "broken"]));
      header.append(portrait, bio);
      card.append(header);
      for (const [key, name] of [["defense", "防线"], ["health", "体魄"], ["compliance", "顺从度"]]) {
        const max = key === "defense" ? src.defense : 100;
        const row = node("div", "p-stat-row");
        const bar = node("div", "p-bar");
        const fill = node("div", "p-bar-fill " + key);
        fill.style.width = p[key] / max * 100 + "%";
        bar.append(fill);
        row.append(node("div", "p-stat-label", name + " " + p[key] + " / " + max), bar);
        card.append(row);
      }
      const actions = node("div", "prison-actions");
      const used = p.last === s.turn;
      if (p.defense && p.health) {
        const torture = addPreview(button("动用大刑", () => interrogate(p, "torture"), "prison-btn torture", used),
          "防线-35 · 体魄-" + tortureDamage());
        if (p.health <= 25) torture.append(node("strong", "lethal-warning", "（极易致死！）"));
        actions.append(torture,
          addPreview(button("威逼", () => interrogate(p, "threat"), "prison-btn", used || s.dread < 40),
            "需威慑≥40 · 防线-20"),
          addPreview(button("利诱", () => interrogate(p, "bribe"), "prison-btn", used),
            "银两-30 · 防线-15 · 体魄+10 · 顺从+25"));
        if (used) card.append(node("div", "action-card-meta", "本旬已审，来旬再问。"));
      } else if (p.health) {
        if (p.id === minister) actions.append(addPreview(
          button("凭口供御前弹劾", () => dispose(p, "impeach"), "prison-btn"), "圣眷+20 · 完成 KPI"));
        else {
          const mustLoot = p.id === clerk && !s.leads.includes(minister);
          actions.append(addPreview(button("抄家追查", () => loot(p), "prison-btn"),
            "银两+" + src.loot_silver + (p.id === clerk ? " · 必得《军饷密账》" : " · 缴获盐引账")),
            addPreview(button("御前请功", () => dispose(p, "credit"), "prison-btn", mustLoot),
              mustLoot ? "主线须先抄家取证" : "圣眷+15 · 威慑+10"),
            addPreview(button("策反留用", () => dispose(p, "spy"), "prison-btn", mustLoot || p.compliance < 60),
              mustLoot ? "主线须先抄家取证" : "需顺从≥60 · 每旬情报+5"));
        }
      }
      card.append(actions);
      list.append(card);
    }
  }
  function renderCards() {
    $("dossier-count").textContent = "已藏：" + ordinaryCards() + " / " + cardCap() + (s.cards.includes(coreEvidence) ? " · 核心 1" : "");
    const list = $("dossier-list");
    list.replaceChildren();
    if (!s.cards.length) list.append(node("div", "map-log-box", "尚无把柄。审讯或暗访可获取铁证。"));
    s.cards.forEach((id, i) => {
      const d = evidence[id];
      const card = node("div", "dossier-card");
      const top = node("div", "dossier-top");
      top.append(node("span", "dossier-grade", d.grade), node("span", "", d.target));
      const btns = node("div", "dossier-btns");
      const target = Object.values(people).find(p => p.title.startsWith(d.target)).id;
      const needCapture = target === minister && !s.captured.includes(minister);
      btns.append(addPreview(button("私下敲诈", () => {
        s.cards.splice(i, 1);
        effect({silver: 120, dread: 5, favor: -5});
        finish("索银");
      }), "银两+120 · 圣眷-5 · 威慑+5"), addPreview(button(needCapture ? "待缉拿侍郎" : "御前弹劾", () => {
        s.cards.splice(i, 1);
        effect({favor: 20});
        if (target === minister) finishKpi();
        else if (!s.defeated.includes(target)) s.defeated.push(target);
        finish("弹劾");
      }, "btn-primary", needCapture), "圣眷+20" + (target === minister ? " · 完成 KPI" : "")));
      card.append(top, node("div", "dossier-title", d.title), node("div", "dossier-desc", d.desc), btns);
      list.append(card);
    });
  }

  function renderEvent() {
    const ev = events.find(e => e.id === s.event);
    choices(ev.tag, ev.title, ev.desc, ev.choices.map(c => [c.seal, c.text, () => {
      effect(c.effects);
      nextTurn(c.seal);
    }, s.silver < -(c.effects.silver || 0), effectsText(c.effects)]));
    const index = s.cards.indexOf(ev.trump_dossier_id);
    if (index >= 0 && s.turn >= 5) {
      const trump = $("event-trump-btn");
      trump.textContent = ev.trump_text;
      addPreview(trump, "消耗" + evidence[ev.trump_dossier_id].title + " · " + effectsText(ev.trump_effects));
      trump.style.display = "block";
      trump.onclick = () => {
        s.cards.splice(index, 1);
        effect(ev.trump_effects);
        nextTurn("反杀");
      };
    }
  }
  function render() {
    modal(null);
    $("intro-overlay").classList.toggle("hidden", s.phase !== "intro");
    $("turn-display").textContent = "第 " + s.turn + " 旬";
    $("ap-dots").replaceChildren(...Array.from({length: maxAp()}, (_, i) =>
      node("span", "ap-dot" + (i < s.ap ? " filled" : ""))));
    $("ap-dots").setAttribute("aria-label", "行动点 " + s.ap + " / " + maxAp());
    for (const key of ["favor", "dread", "silver", "intel"]) {
      $("stat-" + key).textContent = s[key];
      const percent = key === "silver" ? Math.min(100, s.silver / 10) : s[key];
      $("bar-" + key).style.width = percent + "%";
      $("bar-" + key).classList.toggle("danger", percent < 20);
    }
    $("kpi-banner").classList.toggle("visible", s.turn >= 6);
    $("kpi-text").textContent = "御前 KPI：第 15 旬结束前缉拿并弹劾户部侍郎";
    $("kpi-countdown").textContent = "含本旬余 " + (16 - s.turn) + " 旬";
    for (const [key, gate] of Object.entries(gates)) {
      const tab = $("tab-" + key);
      tab.disabled = s.turn < gate;
      tab.classList.toggle("locked", tab.disabled);
      tab.classList.toggle("active", view === key);
      $("view-" + key).classList.toggle("active", view === key);
    }
    for (const [key, n] of [["map", s.jobs.filter(j => !j.sent).length], ["prison", s.inmates.length]]) {
      $("badge-" + key).style.display = n && s.turn >= gates[key] ? "inline" : "none";
      $("badge-" + key).textContent = n;
    }
    renderCamp();
    renderMap();
    renderPrison();
    renderCards();
    if (s.phase === "report") {
      $("report-title").textContent = "第 " + s.turn + " 旬 · 番子回禀";
      $("report-desc").textContent = s.report;
      modal("modal-report");
    } else if (s.phase === "event") renderEvent();
    else if (s.phase === "rescue") {
      const p = s.inmates.find(p => !p.health);
      choices("死无对证", people[p.id].name + "气绝", "圣眷 -20。太医尚可一试。", [
        ["救", "看广告买通太医", () => window.triggerRewardedAd("rescue_prisoner", () => {
          p.health = 20;
          effect({favor: 10});
          if (!p.defense && p.id === merchant) unlockLead(people[p.id].next_target_id);
          s.phase = "play";
          finish("赦");
        }), false, "体魄恢复至20 · 圣眷+10"],
        ["葬", "收殓结案", () => {
          s.inmates.splice(s.inmates.indexOf(p), 1);
          offerTarget(nextTarget());
          s.phase = "play";
          finish("结案");
        }, false, "失去犯人"]
      ]);
    } else if (s.phase === "ending") {
      $("ending-title").textContent = s.ending;
      $("ending-desc").textContent = s.defeated.includes(minister) ?
        "侍郎伏法，西厂交出首份功簿。天子嘉许，进升厂公。" :
        "第 " + s.turn + " 旬，西厂止步于此。";
      modal("modal-ending");
    }
  }

  function showFrame() {
    const f = intro[s.frame];
    if (f.sfx === "heartbeat") sound.play("heartbeat");
    const bg = intro.slice(0, s.frame + 1).filter(frame => frame.bg).pop();
    $("intro-bg").style.backgroundImage = bg ? "url(" + bg.bg + ")" : "none";
    $("intro-bg").classList.toggle("visible", Boolean(bg));
    if (f.bg && f.camera === "slow_zoom_in") animate($("intro-bg"), "zoom-in");
    else $("intro-bg").classList.toggle("zoom-in", Boolean(bg && bg.camera === "slow_zoom_in"));
    document.querySelector(".intro-hint").hidden = f.scene === "stamp_decree";
    $("intro-speaker").textContent = f.speaker || "";
    $("intro-text").textContent = f.text || "";
    $("intro-text").className = "intro-text " + (f.style || "");
    if (f.scene === "palace_shake") animate($("game-shell"), "shake");
    if (f.scene === "stamp_decree") {
      const seal = $("global-stamp");
      seal.style.zIndex = "101";
      seal.addEventListener("animationend", enterCamp);
      stamp(f.stamp_text);
    }
  }

  function enterCamp(event) {
    if (event.animationName !== "stampSlam") return;
    const seal = event.currentTarget;
    seal.removeEventListener("animationend", enterCamp);
    seal.style.removeProperty("z-index");
    s.phase = "play";
    finish();
    $("btn-recruit").focus({focusVisible: true});
  }

  function advanceFrame() {
    if (s.phase !== "intro" || s.frame >= intro.length - 1) return;
    s.frame++;
    finish();
    showFrame();
  }

  async function load(name) {
    const path = "./data/" + name + ".json";
    try {
      const response = await fetch(path);
      if (!response.ok) throw new Error("HTTP " + response.status);
      const rows = await response.json();
      if (!Array.isArray(rows) || !rows.length) throw new Error("卷宗须为非空数组");
      return rows;
    } catch (err) {
      throw new Error(path + " — " + err.message);
    }
  }

  function saveProgress() {
    localStorage.setItem(KEY, JSON.stringify({...s, view, version: 2}));
    storageWarning = "";
  }

  function readProgress() {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return null;
    const saved = JSON.parse(raw);
    if (!saved || !Number.isInteger(saved.turn) || !Array.isArray(saved.inmates))
      throw new Error("存档格式有误");
    const progress = {...fresh(), ...saved};
    if (!saved.recentEvents && saved.event) progress.recentEvents = [saved.event];
    progress.cards = [...new Set(progress.cards)];
    if (saved.version !== 2 && progress.crew.length) {
      progress.ap = Math.max(0, progress.ap - 1);
      progress.note = progress.note.replace("首募成军，亲随与新番子共两队", "新番子入署");
    }
    return progress;
  }

  function displayProgress(progress) {
    s = progress;
    if (s.phase === "play" && s.turn >= 3) {
      if (s.inmates.some(p => p.id === merchant && !p.defense && p.health)) unlockLead(clerk);
      offerTarget(nextTarget());
    }
    view = s.turn >= gates[s.view] ? s.view : s.phase === "rescue" ? "prison" : "camp";
    render();
    if (s.phase === "intro") showFrame();
    if (s.phase === "ending" || s.phase === "event") sound.play("alert");
  }

  function soundLabel() {
    $("settings-sound").textContent = "交互音效：" + (muted ? "关" : "开");
    $("settings-music").textContent = "背景音乐：" + (musicEnabled ? "开" : "关");
    $("settings-music").setAttribute("aria-pressed", String(musicEnabled));
    $("settings-sound").setAttribute("aria-pressed", String(!muted));
  }

  function settingsMenu(confirmRestart = false) {
    $("settings-menu").hidden = confirmRestart;
    $("settings-confirm").hidden = !confirmRestart;
    $("settings-status").textContent = confirmRestart ? "清空当前存档，从穿越分镜重新开始？" : "";
    soundLabel();
    modal("modal-settings");
    $(confirmRestart ? "settings-cancel" : "settings-sound").focus();
  }

  function closeSettings() {
    render();
    $(s.phase === "ending" ? "btn-restart" : "btn-settings").focus();
  }

  function bindSettings() {
    $("btn-settings").onclick = () => settingsMenu();
    $("settings-return").onclick = closeSettings;
    $("settings-restart").onclick = () => settingsMenu(true);
    $("settings-cancel").onclick = () => s.phase === "ending" ? closeSettings() : settingsMenu();
    $("modal-settings").onkeydown = event => {
      if (event.key === "Escape") closeSettings();
    };
    $("settings-music").onclick = () => {
      musicEnabled = !musicEnabled;
      music.sync();
      soundLabel();
      try {
        localStorage.setItem(MUSIC_KEY, musicEnabled ? "on" : "off");
        $("settings-status").textContent = "";
      } catch { $("settings-status").textContent = "音乐已切换，浏览器无法保存偏好。"; }
    };
    $("settings-sound").onclick = () => {
      muted = !muted;
      if (muted) sound.silence();
      else {
        sound.unlock();
        sound.play("click");
      }
      soundLabel();
      try {
        localStorage.setItem(SOUND_KEY, muted ? "muted" : "on");
        $("settings-status").textContent = "";
      } catch { $("settings-status").textContent = "音效已切换，浏览器无法保存偏好。"; }
    };
    $("settings-save").onclick = () => {
      try {
        saveProgress();
        $("settings-status").textContent = "已存档";
      } catch { $("settings-status").textContent = "存档失败，请检查浏览器存储空间和权限。"; }
    };
    $("settings-load").onclick = () => {
      const previous = s;
      const previousView = view;
      try {
        const saved = readProgress();
        if (!saved) {
          $("settings-status").textContent = "暂无存档";
          return;
        }
        displayProgress(saved);
      } catch {
        s = previous;
        view = previousView;
        render();
        settingsMenu();
        $("settings-status").textContent = "读取失败，请检查存档或浏览器存储权限。";
      }
    };
    $("settings-reset").onclick = () => {
      try { localStorage.removeItem(KEY); }
      catch {
        $("settings-status").textContent = "无法清空存档，请检查浏览器存储权限。";
        return;
      }
      displayProgress(fresh());
    };
  }

  async function boot() {
    try {
      muted = localStorage.getItem(SOUND_KEY) === "muted";
      musicEnabled = localStorage.getItem(MUSIC_KEY) !== "off";
    }
    catch { /* Sound preferences are optional when storage is unavailable. */ }
    music.bind();
    sound.bind();
    $("intro-text").textContent = "正在读取开场卷宗……";
    $("intro-overlay").onclick = () => {
      if (s && s.phase === "intro") advanceFrame();
    };
    const [frames, edicts, prisoners] = await Promise.all(["intro", "events", "prisoners"].map(load));
    intro = frames;
    events = edicts;
    people = Object.fromEntries(prisoners.map(p => [p.id, p]));
    evidence = Object.fromEntries(prisoners.filter(p => p.unlocks_dossier)
      .map(p => [p.unlocks_dossier.id, p.unlocks_dossier]));
    let initial = fresh();
    try { initial = readProgress() || initial; }
    catch { storageWarning = "未能读取存档，已从开局开始。"; }
    bindSettings();
    for (const key of Object.keys(gates)) $("tab-" + key).onclick = () => {
      if (s.phase !== "play" || s.turn < gates[key]) return;
      view = key;
      render();
      document.querySelector(".stage-container").scrollTop = 0;
    };
    $("btn-recruit").onclick = recruit;
    $("btn-end-turn").onclick = endTurn;
    $("btn-close-report").onclick = () => {
      if (s.phase !== "report") return;
      if (!s.event) return nextTurn();
      s.phase = "event";
      sound.play("alert");
      finish();
    };
    $("btn-restart").onclick = () => settingsMenu(true);
    displayProgress(initial);
  }
  async function start() {
    try {
      await boot();
    } catch (err) {
      $("intro-overlay").classList.remove("hidden");
      $("intro-speaker").textContent = "游戏初始化失败";
      $("intro-text").textContent = err.message || String(err);
      document.querySelector(".intro-hint").textContent = "点击重新加载 ▸";
      $("intro-overlay").onclick = () => location.reload();
    }
  }
  start();
})();
