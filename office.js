// 会社の見取り図（ドット絵）。キャラの様子は、データベースの記録から決める（飾りではなく、今の状態を表す）。
//   💻 作業中 ／ ☕ 待機・今日の分は完了 ／ 📄 ボスの確認待ち ／ 💦 失敗・止まっている ／ 💤 停止中・練習期間・時間外
(function () {
  const P = 5;
  const PERSON = [
    "..HHHHHH..", ".HHHHHHHH.", ".HSSSSSSH.", ".SSESSESS.", ".SSSSSSSS.", "..SSMMSS..", "...SSSS...",
    ".BBBBBBBB.", "BBBBBBBBBB", "SBBBDDBBBS", "SBBBBBBBBS", ".LLLLLLLL.", ".LLL..LLL.", ".KK....KK.",
  ];
  const ROBOT = [
    "....AA....", "....AA....", ".GGGGGGGG.", ".GWWGGWWG.", ".GWNGGWNG.", ".GGGGGGGG.", ".GGRRRRGG.",
    "...GGGG...", ".GGGGGGGG.", "GGGYYYYGGG", "GGGGGGGGGG", ".GG....GG.", ".GG....GG.", "GGG....GGG",
  ];
  const e = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const shade = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return "#" + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.floor(v * 0.75).toString(16).padStart(2, "0")).join("");
  };
  function sprite(map, x, y, pal) {
    let out = "";
    map.forEach((row, j) => [...row].forEach((c, i) => {
      if (c !== "." && pal[c]) out += `<rect x="${x + i * P}" y="${y + j * P}" width="${P}" height="${P}" fill="${pal[c]}"/>`;
    }));
    return out;
  }
  const person = (x, y, hair, shirt, sad) =>
    sprite(PERSON, x, y, { H: hair, S: "#f5c9a6", E: "#2b2b2b", M: sad ? "#7a4b3a" : "#c0392b", B: shirt, D: shade(shirt), L: "#3b4252", K: "#222" });
  const robot = (x, y, on) => sprite(ROBOT, x, y, { A: on ? "#ffcc4d" : "#8a8f99", G: "#9aa5b1", W: "#fff", N: on ? "#2b9cff" : "#596273", R: on ? "#3dd68c" : "#596273", Y: "#ffcc4d" });
  const desk = (x, y) => `<rect x="${x}" y="${y}" width="90" height="12" fill="#8d6748"/><rect x="${x + 6}" y="${y + 12}" width="8" height="30" fill="#6e4f36"/><rect x="${x + 76}" y="${y + 12}" width="8" height="30" fill="#6e4f36"/>`;
  const pc = (x, y, on) => `<rect x="${x}" y="${y}" width="40" height="28" fill="#2b2f3a"/><rect x="${x + 4}" y="${y + 4}" width="32" height="20" fill="${on ? "#7ee0ff" : "#3a4150"}"/>${on ? `<rect x="${x + 8}" y="${y + 8}" width="18" height="3" fill="#fff"/><rect x="${x + 8}" y="${y + 14}" width="12" height="3" fill="#fff"/>` : ""}<rect x="${x + 16}" y="${y + 28}" width="8" height="6" fill="#2b2f3a"/>`;
  const cup = (x, y) => `<rect x="${x}" y="${y}" width="10" height="10" fill="#fff"/><rect x="${x + 10}" y="${y + 3}" width="3" height="4" fill="#fff"/><rect x="${x + 2}" y="${y - 6}" width="2" height="4" fill="#ccc"/><rect x="${x + 6}" y="${y - 8}" width="2" height="4" fill="#ccc"/>`;
  const paper = (x, y) => `<rect x="${x}" y="${y}" width="16" height="20" fill="#fff" stroke="#999"/><rect x="${x + 3}" y="${y + 5}" width="10" height="2" fill="#999"/><rect x="${x + 3}" y="${y + 10}" width="10" height="2" fill="#999"/>`;
  const sweat = (x, y) => `<path d="M${x} ${y} q-6 9 0 12 q6 -3 0 -12z" fill="#8fd3ff" stroke="#1d2433" stroke-width="1.5"/>`;
  const zzz = (x, y) => `<text x="${x}" y="${y}" font-size="16" font-weight="800" fill="#c3cad6">Z z</text>`;
  const clock = (x, y) => `<circle cx="${x}" cy="${y}" r="14" fill="#fff" stroke="#333" stroke-width="3"/><rect x="${x - 1}" y="${y - 9}" width="2" height="9" fill="#333"/><rect x="${x}" y="${y - 1}" width="7" height="2" fill="#333"/>`;
  const plant = (x, y) => `<rect x="${x}" y="${y + 24}" width="22" height="20" fill="#b5651d"/><rect x="${x + 4}" y="${y}" width="6" height="24" fill="#3dbb6b"/><rect x="${x + 12}" y="${y + 6}" width="6" height="18" fill="#2f9e58"/><rect x="${x - 2}" y="${y + 8}" width="6" height="12" fill="#2f9e58"/>`;
  // 吹き出しは文字数に合わせて幅を決め、部屋からはみ出さないようにする
  function bubble(cx, y, text, color, minX, maxX) {
    const w = Math.min(maxX - minX, [...text].length * 13 + 18);
    const x = Math.max(minX, Math.min(cx - w / 2, maxX - w));
    return `<rect x="${x}" y="${y}" width="${w}" height="24" rx="6" fill="${color || "#fff"}" stroke="#1d2433" stroke-width="2"/><text x="${x + 9}" y="${y + 17}" font-size="13" font-weight="700" fill="#1d2433">${e(text)}</text>`;
  }
  const board = (x, y, w, lines) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${18 + lines.length * 18}" fill="#f7f7f2" stroke="#8d6748" stroke-width="4"/>` +
    lines.map((t, i) => `<text x="${x + 9}" y="${y + 21 + i * 18}" font-size="12" fill="#33415c">${e(t)}</text>`).join("");

  const ROOM_H = 360, SLOT_W = 104, OY = 30; // OY：ホワイトボードと吹き出しが重ならないよう、人と机を下げる量
  /** 1人分。state: work / coffee / paper / trouble / sleep */
  function worker(cx, w, minX, maxX, lift = 0) {
    const x = cx - 45;
    const body = w.robot ? robot(cx - 25, 152 + OY, w.state === "work") : person(cx - 25, 158 + OY, w.hair, w.shirt, w.state === "trouble");
    return body + desk(x, 212 + OY) + (w.pc === false ? "" : pc(x + 52, 178 + OY, w.state === "work")) +
      (w.state === "coffee" ? cup(x + 8, 202 + OY) : "") + (w.state === "paper" ? paper(x + 4, 192 + OY) : "") +
      (w.state === "trouble" ? sweat(cx + 26, 150 + OY) + sweat(cx - 30, 160 + OY) : "") + (w.state === "sleep" ? zzz(cx + 10, 150 + OY) : "") +
      (w.say ? bubble(cx, 112 + OY - lift, w.say, w.state === "paper" ? "#fff3c4" : w.state === "trouble" ? "#ffd9d6" : "#fff", minX + 4, maxX - 4) : "") +
      `<text x="${cx}" y="${ROOM_H - 30}" font-size="13" font-weight="700" fill="#fff" text-anchor="middle">${e(w.name)}</text>` +
      `<text x="${cx}" y="${ROOM_H - 13}" font-size="11" fill="#d6dce8" text-anchor="middle">${e(w.status)}</text>`;
  }
  function roomSvg(room) {
    const W = Math.max(220, room.workers.length * SLOT_W + 30);
    // 吹き出しが隣と重ならないよう、話している人が続くときは1人おきに高さを変える
    let talk = 0;
    const people = room.workers.map((w, i) => worker(15 + SLOT_W / 2 + i * SLOT_W + (W - 30 - room.workers.length * SLOT_W) / 2, w, 0, W, w.say ? (talk++ % 2) * 30 : 0)).join("");
    return `<a class="room" href="${room.href}" style="flex-basis:${Math.round(W * 0.85)}px;max-width:${W}px" aria-label="${e(room.title)}を開く"><svg viewBox="0 0 ${W} ${ROOM_H}" xmlns="http://www.w3.org/2000/svg" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" role="img">
      <rect width="${W}" height="${ROOM_H}" fill="${room.color}"/>
      <rect width="${W}" height="34" fill="rgba(0,0,0,.25)"/>
      <text x="${W / 2}" y="23" font-size="16" font-weight="800" fill="#fff" text-anchor="middle">${e(room.title)}</text>
      ${room.board ? board(14, 42, Math.min(W - 70, 230), room.board) : ""}${clock(W - 26, 62)}${room.plant ? plant(10, 216 + OY) : ""}
      <rect y="${ROOM_H - 52}" width="${W}" height="52" fill="rgba(0,0,0,.2)"/>
      ${people}</svg></a>`;
  }

  /** 記録から、それぞれのキャラの様子を決める */
  function rooms(d) {
    const now = d.now;
    const jst = (x) => new Date(x.getTime() + 9 * 3600e3);
    const hour = jst(now).getUTCHours();
    const today = jst(now).toISOString().slice(0, 10);
    const dayStart = new Date(`${today}T00:00:00+09:00`);
    const paused = d.st.ai_paused_until && new Date(d.st.ai_paused_until) > now;
    const pending = d.proposals.filter((p) => d.approvals.some((a) => a.proposal_id === p.id)).length;
    const yen = (n) => `¥${Math.round(n).toLocaleString("ja-JP")}`;
    const sleepAll = (w) => (paused ? { ...w, state: "sleep", say: "", status: "一時停止中" } : w);

    // CEO
    const plannedToday = d.usage.some((u) => u.purpose === "ceo_plan" && new Date(u.created_at) >= dayStart);
    const ceo = pending > 0
      ? { state: "paper", say: `ボス、判断を…（${pending}件）`, status: `承認待ち ${pending}件` }
      : plannedToday ? { state: "coffee", status: "今日の計画は済み" } : hour < 9 ? { state: "sleep", status: "9時に計画" } : { state: "work", say: "計画を立て中", status: "計画中" };

    // KDPの部門
    const deptState = (key) => {
      const running = d.openTasks.find((t) => t.department_key === key && t.status === "running");
      const queued = d.openTasks.filter((t) => t.department_key === key && t.status === "queued");
      const trouble = d.recentTasks.find((t) => t.department_key === key && ["failed", "blocked"].includes(t.status) && t.finished_at && new Date(t.finished_at) >= dayStart);
      if (running) return { state: "work", say: running.title.slice(0, 12), status: "作業中" };
      if (trouble) return { state: "trouble", say: "うまくいきません…", status: "失敗・中断あり" };
      if (queued.length) return { state: "paper", status: `順番待ち ${queued.length}件` };
      return { state: "coffee", status: "待機" };
    };
    const kdpCost = d.usage.filter((u) => new Date(u.created_at) >= new Date(`${today.slice(0, 7)}-01T00:00:00+09:00`) && (u.business_key || "company") === "kdp").reduce((a, u) => a + Number(u.cost_yen), 0);
    const kdpCap = d.businesses.find((b) => b.key === "kdp")?.monthly_budget_yen || 0;

    // スマホ代ラボ
    const t = d.threads;
    const todays = ["noon", "night"].map((slot) => t.drafts.filter((x) => x.for_date === today && x.slot === slot).sort((a, b) => b.created_at.localeCompare(a.created_at))[0]).filter(Boolean);
    const qaFailed = todays.filter((x) => x.status === "qa_failed").length;
    const stale = t.facts.filter((f) => (now - new Date(`${f.checked_at}T00:00:00+09:00`)) / 86400e3 > 7).length;
    const factWaiting = (t.changes || []).length;
    const publishOn = d.st.threads_publish_enabled === true;
    const failedPost = todays.find((x) => x.status === "failed");
    const nextSlot = hour < 12 || (hour === 12 && jst(now).getUTCMinutes() < 30) ? "12:30" : hour < 21 ? "21:00" : null;
    const label = { ready: "承認待ち", approved: "承認済み", posted: "投稿済み", qa_failed: "お休み", skipped: "見送り", rejected: "書き直し", failed: "失敗" };

    const research = factWaiting ? { state: "paper", say: `料金の確認を…（${factWaiting}件）`, status: "ボスの確認待ち" }
      : stale ? { state: "trouble", say: "確認できない料金が…", status: `古い料金 ${stale}件` }
      : { state: "coffee", status: t.facts.length ? "料金は確認済み" : "待機" };
    const editor = !todays.length ? (hour < 5 ? { state: "sleep", status: "5時に開始" } : { state: "trouble", say: "下書きがありません", status: "下書きなし" })
      : todays.some((x) => x.status === "ready") ? { state: "paper", say: "ボス、見てください", status: "承認待ち" }
      : { state: "coffee", status: "今日の分は完成" };
    const qa = qaFailed ? { state: "trouble", say: `${qaFailed}本を止めました`, status: "不合格あり" } : { state: todays.length ? "coffee" : "sleep", status: todays.length ? "チェック済み" : "待機" };
    const ops = failedPost ? { state: "trouble", say: "投稿に失敗…", status: "投稿失敗" }
      : !publishOn ? { state: "sleep", status: "練習期間" }
      : nextSlot && todays.some((x) => x.status === "approved") ? { state: "work", say: `${nextSlot}に投稿します`, status: "待機中" }
      : { state: "coffee", status: "今日の投稿は終わり" };
    const review = d.st.threads_weekly_review;
    const reviewFresh = review && now - new Date(review.at) < 2 * 86400e3;
    const manager = reviewFresh ? { state: "paper", say: "振り返りを報告", status: "振り返り済み" } : { state: "coffee", status: "月曜に振り返り" };
    const thCost = d.usage.filter((u) => new Date(u.created_at) >= new Date(`${today.slice(0, 7)}-01T00:00:00+09:00`) && u.business_key === "threads").reduce((a, u) => a + Number(u.cost_yen), 0);
    const thCap = d.businesses.find((b) => b.key === "threads")?.monthly_budget_yen || 0;

    return [
      { title: "CEO室", href: "#home", color: "#5b4a7a", plant: true,
        workers: [sleepAll({ name: "CEO", hair: "#2b2b2b", shirt: "#2f3e66", ...ceo })] },
      { title: "KDP（本）", href: "#kdp", color: "#2f6f73", board: [`今月 ${yen(kdpCost)}／${yen(kdpCap)}`],
        workers: [
          sleepAll({ name: d.deptName.analysis || "分析部門", hair: "#6b3d1f", shirt: "#d98c3b", ...deptState("analysis") }),
          sleepAll({ name: d.deptName.planning || "企画部門", hair: "#1f1f1f", shirt: "#3b82f6", ...deptState("planning") }),
        ] },
      { title: "スマホ代ラボ（Threads）", href: "#sumaho", color: "#1f7a5c",
        board: [`今日：${todays.map((x) => `${x.slot === "noon" ? "昼" : "夜"} ${label[x.status] || x.status}`).join("・") || "まだ"}`, `今月 ${yen(thCost)}／${yen(thCap)}${publishOn ? "" : "・練習期間"}`],
        workers: [
          sleepAll({ name: "調査・分析", hair: "#a0522d", shirt: "#8e5cd9", ...research }),
          sleepAll({ name: "編集", hair: "#2b2b2b", shirt: "#ff8a5c", ...editor }),
          sleepAll({ name: "品質管理", hair: "#d4a017", shirt: "#e5484d", ...qa }),
          sleepAll({ name: "運用", robot: true, ...ops }),
          sleepAll({ name: "事業部長", hair: "#555", shirt: "#0f9d8a", pc: false, ...manager }),
        ] },
    ];
  }

  window.renderOffice = function (d) {
    const roof = `<svg class="roof" viewBox="0 0 1000 86" xmlns="http://www.w3.org/2000/svg" font-family="'Hiragino Sans','Noto Sans JP',sans-serif" role="img" aria-label="AI会社">
      <polygon points="0,40 500,0 1000,40" fill="#a83c3c"/><rect y="40" width="1000" height="46" fill="#c94f4f"/>
      <rect x="390" y="48" width="220" height="30" rx="6" fill="#fff4d6"/>
      <text x="500" y="70" font-size="18" font-weight="900" fill="#7a2e2e" text-anchor="middle">AI会社</text></svg>`;
    return `<div class="office">${roof}<div class="rooms">${rooms(d).map(roomSvg).join("")}</div>
      <div class="small muted office-note">キャラの様子は記録どおり：💻作業中・☕待機・📄ボスの確認待ち・💦失敗・💤停止中／時間外。部屋を押すと事業部のページへ</div></div>`;
  };
})();
