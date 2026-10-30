// AI会社 ダッシュボード（見る専用）
// データベースの記録をそのまま表示するだけ。AIは呼ばない（表示に費用はかからない）。
// 書き換え・実行の機能はない。データベース側でも「読むだけ」の許可しか与えていない。

const db = supabase.createClient(window.DASHBOARD_CONFIG.supabaseUrl, window.DASHBOARD_CONFIG.publishableKey, {
  auth: { persistSession: true, autoRefreshToken: true },
});

// ---------- 小さな道具 ----------
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const yen = (n) => `¥${Math.round(n).toLocaleString("ja-JP")}`;
const JST = 9 * 3600e3;
const jstDate = (d) => new Date(d.getTime() + JST).toISOString().slice(0, 10);
const jstDayStart = (d) => new Date(`${jstDate(d)}T00:00:00+09:00`);
const jstMonthStart = (d) => new Date(`${jstDate(d).slice(0, 7)}-01T00:00:00+09:00`);
const fmt = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const s = new Date(d.getTime() + JST).toISOString();
  return `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))} ${s.slice(11, 16)}`;
};
const md = (text) => DOMPurify.sanitize(marked.parse(String(text ?? "")));

const DEPT_FALLBACK = { analysis: "分析部門", planning: "企画部門" };
const TASK_STATUS = { queued: "未着手", running: "実行中", done: "完了", failed: "失敗", blocked: "中断", cancelled: "中止" };
const INSTR_STATUS = { new: "未処理", applied: "反映済み", needs_clarification: "確認待ち" };
const PURPOSE = {
  ceo_plan: "CEOの計画", dept_task: "部門の仕事", dept_research: "検索ありの調査", morning_narrative: "朝の報告",
  weekly_review: "週の振り返り", search_test: "検索の試験",
  threads_draft: "投稿の下書き", threads_qa: "投稿のチェック",
};
const BIZ_LABEL = { kdp: "KDP", threads: "スマホ代ラボ", company: "全社（CEO・報告）" };
const DRAFT_STATUS = {
  draft: "下書き", qa_failed: "チェック不合格（お休み）", ready: "承認待ち", approved: "承認済み", rejected: "書き直し済み",
  posted: "投稿済み", skipped: "見送り", failed: "投稿失敗",
};
const SLOT = { noon: "お昼 12:30", night: "夜 21:00" };
// 定期実行の時刻（日本時間）。supabase/migrations/0005_scheduler.sql と同じ
const SCHEDULE = [
  ["07:41", "朝の報告"], ["09:04", "CEOの計画"], ["11:04", "定期処理"], ["14:04", "定期処理"],
  ["17:04", "定期処理"], ["20:04", "定期処理"], ["23:04", "定期処理"],
];

async function rows(query, label) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data ?? [];
}

/** 1000件を超えても全部読む */
async function allRows(make, label) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const page = await rows(make().range(from, from + 999), label);
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

// ---------- データの読み込み ----------
let data = null;

async function load() {
  const now = new Date();
  const since = new Date(Math.min(jstMonthStart(now).getTime(), now.getTime() - 14 * 86400e3));
  const [settingsRows, state, usage, depts, openTasks, recentTasks, proposals, approvals, questions, instructions,
    notifications, artifacts, reports, decisions, businesses, policies] = await Promise.all([
    rows(db.from("settings").select("key,value"), "settings"),
    rows(db.from("system_state").select("key,value,updated_at"), "system_state"),
    allRows(() => db.from("llm_usage").select("created_at,purpose,cost_yen,ok,web_searches,business_key").gte("created_at", since.toISOString()).order("created_at"), "llm_usage"),
    rows(db.from("departments").select("key,name,business_key"), "departments"),
    rows(db.from("tasks").select("id,department_key,title,status,created_at,started_at,finished_at,last_error").in("status", ["queued", "running"]).order("created_at"), "tasks"),
    rows(db.from("tasks").select("id,department_key,title,status,created_at,finished_at,last_error").order("created_at", { ascending: false }).limit(60), "tasks"),
    rows(db.from("action_proposals").select("id,description,category,status,created_at").eq("status", "awaiting_owner"), "action_proposals"),
    rows(db.from("approvals").select("id,proposal_id,status,expires_at").eq("status", "pending"), "approvals"),
    rows(db.from("owner_questions").select("id,body,created_at").eq("status", "open").order("created_at"), "owner_questions"),
    rows(db.from("owner_instructions").select("id,body,status,ceo_interpretation,created_at,processed_at").order("created_at", { ascending: false }).limit(30), "owner_instructions"),
    rows(db.from("notifications").select("id,kind,body,delivered,reported,created_at").order("created_at", { ascending: false }).limit(30), "notifications"),
    rows(db.from("artifacts").select("id,task_id,title,created_at").order("created_at", { ascending: false }).limit(50), "artifacts"),
    rows(db.from("daily_reports").select("report_date,rendered,delivered_at,delivery_error").order("report_date", { ascending: false }).limit(14), "daily_reports"),
    rows(db.from("decisions").select("summary,rationale,created_at").order("created_at", { ascending: false }).limit(40), "decisions"),
    rows(db.from("businesses").select("name,description,kpi,status,key,monthly_budget_yen"), "businesses"),
    rows(db.from("policies").select("title,body,version,effective_from").is("effective_to", null).order("effective_from"), "policies"),
  ]);
  const expired = await rows(db.from("approvals").select("id,proposal_id,expires_at").eq("status", "expired")
    .gte("expires_at", new Date(now.getTime() - 7 * 86400e3).toISOString()).order("expires_at", { ascending: false }), "approvals.expired");
  const expiredProposals = expired.length
    ? await rows(db.from("action_proposals").select("id,description,category").in("id", expired.map((a) => a.proposal_id)), "action_proposals.expired")
    : [];
  let productionUpdates = [];
  try {
    productionUpdates = await rows(db.from("production_updates").select("body,created_at").order("created_at", { ascending: false }).limit(30), "production_updates");
  } catch { /* 表がまだなくても他は見せる */ }
  // スマホ代ラボ（Threads事業部）。表がまだなくても他は見せる
  let threads = { drafts: [], posted: [], metrics: [], facts: [], a8: [] };
  try {
    const twoWeeks = jstDate(new Date(now.getTime() - 14 * 86400e3));
    const [drafts, facts, a8] = await Promise.all([
      rows(db.from("threads_drafts").select("id,for_date,slot,kind,body,link_url,status,qa_notes,image_url,posted_at,error,created_at").gte("for_date", twoWeeks).order("created_at", { ascending: false }), "threads_drafts"),
      rows(db.from("threads_price_facts").select("carrier,plan,item,value_text,note,source_url,checked_at,valid_from,valid_to,status").eq("status", "active").order("carrier"), "threads_price_facts"),
      rows(db.from("threads_a8_weekly").select("week_start,clicks,confirmed,reward_yen").order("week_start", { ascending: false }).limit(12), "threads_a8_weekly"),
    ]);
    const posted = drafts.filter((d) => d.status === "posted");
    const metrics = posted.length
      ? await rows(db.from("threads_metrics").select("draft_id,age_days,views,likes,replies,reposts,quotes,shares").in("draft_id", posted.map((d) => d.id)), "threads_metrics")
      : [];
    threads = { drafts, posted, metrics, facts, a8 };
  } catch { /* 表示できなくても他は見せる */ }
  let scheduler = null;
  try {
    const { data: s } = await db.rpc("dashboard_scheduler");
    scheduler = s;
  } catch { /* 表示できなくても他は見せる */ }

  const settings = Object.fromEntries(settingsRows.map((r) => [r.key, Number(r.value)]));
  const st = Object.fromEntries(state.map((r) => [r.key, r.value]));
  const deptName = Object.fromEntries(depts.map((d) => [d.key, d.name]));
  const taskById = Object.fromEntries(recentTasks.map((t) => [t.id, t]));
  data = { now, settings, st, usage, deptName, taskById, openTasks, recentTasks, proposals, approvals, questions,
    instructions, notifications, artifacts, reports, decisions, businesses, policies, scheduler,
    productionUpdates, threads,
    deptBiz: Object.fromEntries(depts.map((d) => [d.key, d.business_key || "kdp"])),
    expired: expired.map((a) => ({ a, p: expiredProposals.find((p) => p.id === a.proposal_id) })).filter((x) => x.p) };
  $("#updated").textContent = `最終更新 ${fmt(now.toISOString())}`;
}

const dept = (k) => data.deptName[k] ?? DEPT_FALLBACK[k] ?? k;
const spendSince = (t) => data.usage.filter((u) => new Date(u.created_at) >= t).reduce((a, u) => a + Number(u.cost_yen), 0);

// 予算（src/budget.ts と同じ考え方：上限は設定値（ボスが決めた最大20,000円まで）、AIに使えるのは (上限 − 固定費) × 停止ライン）
const ABSOLUTE_CAP = 20000;
function budget() {
  const s = data.settings;
  const cap = Math.min(s.monthly_cap_yen || 10000, ABSOLUTE_CAP);
  const monthLimit = (cap - (s.fixed_monthly_costs_yen || 0)) * (s.stop_ratio || 0.8);
  return { cap, monthLimit, dailyCap: s.daily_cap_yen || 400, usdJpy: s.usd_jpy || 160 };
}

/** 事業部ごとの今月の費用と上限（company＝全社） */
function bizCost(key) {
  const monthStart = jstMonthStart(data.now);
  const spent = data.usage.filter((u) => new Date(u.created_at) >= monthStart && (u.business_key || "company") === key).reduce((a, u) => a + Number(u.cost_yen), 0);
  const cap = key === "company" ? data.settings.company_budget_yen || 0 : data.businesses.find((b) => b.key === key)?.monthly_budget_yen || 0;
  return { spent, cap };
}
function bizBar(key) {
  const { spent, cap } = bizCost(key);
  const pct = cap ? Math.min(100, (spent / cap) * 100) : 0;
  const cls = cap && spent / cap >= 0.9 ? "bad" : cap && spent / cap >= 0.7 ? "warn" : "";
  return `<div class="row"><span>${esc(BIZ_LABEL[key] ?? key)}</span><span>${yen(spent)}${cap ? ` / ${yen(cap)}` : ""}</span></div>` +
    (cap ? `<div class="bar ${cls}"><div style="width:${pct}%"></div></div>` : "");
}

// Claude APIの残高（src/credit.ts と同じ計算）
function credit() {
  const rec = data.st.api_credit;
  if (!rec || !rec.base_at) return null;
  const { usdJpy } = budget();
  const topups = (rec.topups || []).reduce((a, t) => a + (Number(t.usd) || 0), 0);
  const remainingUsd = Number(rec.base_usd) + topups - spendSince(new Date(rec.base_at)) / usdJpy;
  const burnYen = Math.max(50, spendSince(new Date(data.now.getTime() - 3 * 86400e3)) / 3);
  const burnUsd = burnYen / usdJpy;
  const daysLeft = Math.max(0, remainingUsd) / burnUsd;
  return { remainingUsd, burnUsd, daysLeft, low: daysLeft <= 3 };
}

function nextRun() {
  const now = data.now;
  for (let add = 0; add < 2; add++) {
    const day = jstDate(new Date(now.getTime() + add * 86400e3));
    for (const [hm, label] of SCHEDULE) {
      const t = new Date(`${day}T${hm}:00+09:00`);
      if (t > now) return { at: t, label };
    }
  }
  return null;
}

// ---------- 画面 ----------
function card(title, body, count) {
  return `<section class="card"><h2>${esc(title)}${count !== undefined ? `<span class="count">${count}件</span>` : ""}</h2>${body}</section>`;
}
const list = (items, render, empty = "なし") => (items.length ? items.map(render).join("") : `<div class="empty">${esc(empty)}</div>`);

function viewHome() {
  const now = data.now;
  const b = budget();
  const today = spendSince(jstDayStart(now));
  const month = spendSince(jstMonthStart(now));
  const c = credit();
  const paused = data.st.ai_paused_until && new Date(data.st.ai_paused_until) > now;
  const next = nextRun();
  const lastActivity = data.usage.length ? data.usage[data.usage.length - 1].created_at : null;

  // 要対応
  const pending = data.proposals.map((p) => ({ p, a: data.approvals.find((a) => a.proposal_id === p.id) })).filter((x) => x.a);
  // 「確認待ち」の指示は、CEOの質問（owner_questions）として別に出るので、ここでは未処理のものだけ
  const waitingInstr = data.instructions.filter((i) => i.status === "new");
  const undelivered = data.notifications.filter((n) => !n.delivered && !n.reported);
  const daysLeft = (iso) => (new Date(iso).getTime() - now.getTime()) / 86400e3;
  const approvalBody =
    `<div class="row"><span>承認待ち</span><span>${pending.length}件</span></div>` +
    pending.map(({ p, a }) => {
      const d = daysLeft(a.expires_at);
      const urgent = d <= 2;
      return `<div class="item"><span class="pill">${p.category === "B" ? "承認" : "判断"}</span>${esc(p.description)}
        <div class="meta${urgent ? " urgent" : ""}">${urgent ? `あと${Math.max(0, Math.ceil(d))}日で期限切れ（${fmt(a.expires_at)}）` : `期限 ${fmt(a.expires_at)}`}・LINEの「承認一覧」から操作できます</div></div>`;
    }).join("") +
    (data.expired.length
      ? `<div class="subhead">見逃して期限切れになったもの（直近7日）</div>` +
        data.expired.map(({ p, a }) => `<div class="item"><span class="pill">期限切れ</span>${esc(p.description)}
          <div class="meta">${fmt(a.expires_at)} に期限切れ・必要ならLINEでCEOに「もう一度提案して」と送ってください</div></div>`).join("")
      : `<div class="small muted">見逃して期限切れになったもの（直近7日）：なし</div>`);

  const todo =
    list(data.questions, (q) => `<div class="item"><span class="pill">質問</span>${esc(q.body)}<div class="meta">${fmt(q.created_at)}</div></div>`, "") +
    list(waitingInstr, (i) => `<div class="item"><span class="pill">${INSTR_STATUS[i.status]}</span>${esc(i.body.slice(0, 120))}${i.body.length > 120 ? "…" : ""}
      <div class="meta">${fmt(i.created_at)}${i.status === "new" ? "・次の定期処理でCEOが読みます" : ""}</div></div>`, "") +
    list(undelivered, (n) => `<div class="item"><span class="pill">未配信の通知</span>${esc(n.body.slice(0, 160))}<div class="meta">${fmt(n.created_at)}</div></div>`, "");
  const todoCount = data.questions.length + waitingInstr.length + undelivered.length;

  // 稼働状況
  let status;
  if (paused) {
    status = `<div class="status bad"><b>AIの処理を一時停止中</b>${esc(data.st.ai_paused_reason || "")}<br>再開予定：${fmt(data.st.ai_paused_until)}（LINEで「再開」と送るとすぐ再開）</div>`;
  } else if (today >= b.dailyCap * 0.85) {
    status = `<div class="status warn"><b>今日の費用の上限に近づいています</b>重い調査は明日0時以降に回ります（${yen(today)} / ${yen(b.dailyCap)}）</div>`;
  } else {
    status = `<div class="status ok"><b>動いています</b>止まる理由は見つかっていません</div>`;
  }
  if (c?.low) status += `<div class="status warn"><b>Claude APIの残高が少なくなっています</b>あと約${Math.floor(c.daysLeft)}日分（約$${c.remainingUsd.toFixed(2)}）。チャージしたらLINEで「チャージ 20」と送ってください</div>`;

  const runs = data.scheduler?.recent_runs ?? [];
  const lastRun = runs[0];
  const failedRuns = runs.filter((r) => r.status && r.status !== "succeeded");
  if (failedRuns.length) status += `<div class="status bad"><b>定期実行の起動に失敗した記録があります</b>${esc(failedRuns[0].jobname)}（${fmt(failedRuns[0].start_time)}）</div>`;

  const statusBody = status +
    `<div class="row"><span>最後にAIが動いた時刻</span><span>${lastActivity ? fmt(lastActivity) : "記録なし"}</span></div>` +
    `<div class="row"><span>最後の起動</span><span>${lastRun ? `${fmt(lastRun.start_time)}（${lastRun.status === "succeeded" ? "成功" : esc(lastRun.status)}）` : "不明"}</span></div>` +
    `<div class="row"><span>次の予定</span><span>${next ? `${fmt(next.at.toISOString())} ${next.label}` : "-"}</span></div>`;

  // 費用（要約）
  const pct = (v, max) => Math.min(100, (v / max) * 100);
  const cls = (v, max) => (v / max >= 0.9 ? "bad" : v / max >= 0.7 ? "warn" : "");
  const costBody =
    `<div class="row"><span>今日</span><span>${yen(today)} / ${yen(b.dailyCap)}</span></div>
     <div class="bar ${cls(today, b.dailyCap)}"><div style="width:${pct(today, b.dailyCap)}%"></div></div>
     <div class="row"><span>今月</span><span>${yen(month)} / ${yen(b.monthLimit)}</span></div>
     <div class="bar ${cls(month, b.monthLimit)}"><div style="width:${pct(month, b.monthLimit)}%"></div></div>` +
    (c ? `<div class="row"><span>Claude APIの残高（計算上）</span><span>約$${c.remainingUsd.toFixed(2)}（あと約${Math.floor(c.daysLeft)}日分）</span></div>` : "");

  // 事業部の様子（くわしくは各タブ）
  const kdpOpen = data.openTasks.filter((t) => (data.deptBiz[t.department_key] || "kdp") === "kdp");
  const todayDrafts = latestDrafts(jstDate(now));
  const sumahoLine = todayDrafts.length
    ? todayDrafts.map((d) => `${SLOT[d.slot]}：${DRAFT_STATUS[d.status] ?? d.status}`).join("／")
    : "今日の下書きはまだありません（毎朝5:00に作ります）";
  const divisions =
    `<div class="item"><a class="link" href="#kdp">KDP →</a><div class="meta">進行中・未着手の仕事 ${kdpOpen.length}件</div></div>` +
    `<div class="item"><a class="link" href="#sumaho">スマホ代ラボ →</a><div class="meta">${esc(publishMode())}・${esc(sumahoLine)}</div></div>`;

  return (
    card("承認", approvalBody) +
    card("要対応（質問・指示・通知）", todoCount ? todo : `<div class="empty">今、ボスがやることはありません</div>`, todoCount) +
    card("事業部", divisions) +
    card("稼働状況", statusBody) +
    card("費用（AI・会社全体）", costBody + `<div class="small"><a class="link" href="#cost">事業部ごと・くわしく見る →</a></div>`)
  );
}

// ---------- 事業部：KDP ----------
const taskItem = (t) => `<div class="item"><span class="pill">${TASK_STATUS[t.status] ?? t.status}</span>${esc(t.title)}
  <div class="meta">${t.finished_at ? fmt(t.finished_at) : fmt(t.created_at)}・${esc(dept(t.department_key))}${t.last_error && t.status !== "done" ? `・${esc(t.last_error.slice(0, 100))}` : ""}</div></div>`;

function viewKdp() {
  const isKdp = (k) => (data.deptBiz[k] || "kdp") === "kdp";
  const biz = data.businesses.find((b) => b.key === "kdp");
  const open = data.openTasks.filter((t) => isKdp(t.department_key));
  const recent = data.recentTasks.filter((t) => isKdp(t.department_key) && t.status !== "queued" && t.status !== "running").slice(0, 15);
  const arts = data.artifacts.filter((a) => { const t = data.taskById[a.task_id]; return !t || isKdp(t.department_key); });
  return (
    (biz ? card("KDP（Amazonの本）", `<details class="item"><summary>事業の内容と目標</summary><pre class="report">${esc(biz.description)}\n\n目標：${esc(biz.kpi)}</pre></details>`) : "") +
    card("費用（今月）", bizBar("kdp")) +
    card("進行中・未着手の仕事", list(open, taskItem), open.length) +
    card("成果物", list(arts.slice(0, 20), (a) => {
      const t = data.taskById[a.task_id];
      return `<div class="item"><a class="link" href="#artifact/${a.id}">${esc(a.title)}</a>
        <div class="meta">${fmt(a.created_at)}${t ? `・${esc(dept(t.department_key))}` : ""}</div></div>`;
    }, "まだありません"), arts.length) +
    card("最近終わった仕事", list(recent, taskItem), recent.length)
  );
}

// ---------- 事業部：スマホ代ラボ（Threads） ----------
function publishMode() {
  return data.st.threads_publish_enabled === true ? "本番（承認した投稿を自動で投稿）" : "練習期間（承認しても投稿しない）";
}
/** その日の枠ごとの最新の下書き */
function latestDrafts(date) {
  const out = [];
  for (const slot of ["noon", "night"]) {
    const d = data.threads.drafts.filter((x) => x.for_date === date && x.slot === slot).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    if (d) out.push(d);
  }
  return out;
}
function draftItem(d, withImage) {
  const m = data.threads.metrics.filter((x) => x.draft_id === d.id).sort((a, b) => b.age_days - a.age_days)[0];
  return `<details class="item"${withImage ? " open" : ""}><summary><span class="pill">${esc(DRAFT_STATUS[d.status] ?? d.status)}</span>${esc(d.for_date.slice(5).replace("-", "/"))} ${esc(SLOT[d.slot] ?? d.slot)}
      ${m ? `<span class="muted small">　表示 ${m.views}・いいね ${m.likes}・返信 ${m.replies}（${m.age_days}日後）</span>` : ""}</summary>
    ${withImage && d.image_url ? `<img class="thumb" src="${esc(d.image_url)}" alt="" loading="lazy">` : ""}
    <pre class="report">${esc(d.body)}${d.link_url ? `\n${esc(d.link_url)}` : ""}</pre>
    ${d.qa_notes ? `<div class="meta">チェックの指摘：${esc(d.qa_notes)}</div>` : ""}${d.error ? `<div class="meta urgent">${esc(d.error)}</div>` : ""}</details>`;
}

function viewSumaho() {
  const t = data.threads;
  const today = jstDate(data.now);
  const status = data.st.threads_publish_enabled === true
    ? `<div class="status ok"><b>本番</b>承認した投稿だけを、12:30と21:00に自動で投稿します</div>`
    : `<div class="status warn"><b>練習期間</b>朝のLINEのカードで承認しても、自動では投稿しません</div>`;
  const latest = t.posted.map((d) => t.metrics.filter((m) => m.draft_id === d.id).sort((a, b) => b.age_days - a.age_days)[0]).filter(Boolean);
  const sum = (k) => latest.reduce((a, m) => a + (m[k] || 0), 0);
  const perf = t.posted.length
    ? `<div class="row"><span>投稿数（直近14日）</span><span>${t.posted.length}本</span></div>
       <div class="row"><span>表示回数（合計）</span><span>${sum("views").toLocaleString("ja-JP")}</span></div>
       <div class="row"><span>いいね・返信・再投稿</span><span>${sum("likes")}・${sum("replies")}・${sum("reposts")}</span></div>`
    : `<div class="empty">まだ投稿はありません</div>`;
  const stale = (f) => (data.now.getTime() - new Date(`${f.checked_at}T00:00:00+09:00`).getTime()) / 86400e3 > 7;
  const facts = list(t.facts, (f) => `<div class="item"><b>${esc(f.carrier)}</b> ${esc(f.plan)}：${esc(f.item)} <b>${esc(f.value_text)}</b>
    <div class="meta${stale(f) ? " urgent" : ""}">確認日 ${esc(f.checked_at)}${stale(f) ? "（7日を過ぎたので投稿には使わない）" : ""}${f.note ? `・${esc(f.note)}` : ""}・<a class="link" href="${esc(f.source_url)}" target="_blank" rel="noopener">公式ページ</a></div></div>`,
    "まだありません（公式ページで確認できた料金を、確認日つきで入れていきます）");
  const a8 = list(t.a8, (w) => `<div class="row"><span>${esc(w.week_start)}の週</span><span>${w.confirmed ?? "-"}件・${w.reward_yen != null ? yen(w.reward_yen) : "-"}</span></div>`, "まだ記録はありません");
  return (
    card("スマホ代ラボ（Threads @sumahodai_labo）", status +
      `<div class="small"><a class="link" href="https://sumahodai-lab.com" target="_blank" rel="noopener">サイトを開く</a>　<a class="link" href="https://www.threads.net/@sumahodai_labo" target="_blank" rel="noopener">Threadsを開く</a></div>`) +
    card("今日の投稿", list(latestDrafts(today), (d) => draftItem(d, true), "まだありません（毎朝5:00に作ります）")) +
    card("成績", perf) +
    card("費用（今月）", bizBar("threads")) +
    card("最近の投稿・下書き（14日）", list(t.drafts.filter((d) => d.for_date !== today).slice(0, 30), (d) => draftItem(d, false), "まだありません")) +
    card("料金の一覧表", facts, t.facts.length) +
    card("A8の成果（週ごと・ボスが送った合計）", a8)
  );
}

function viewArtifacts() {
  return card(
    "成果物",
    list(data.artifacts, (a) => {
      const t = data.taskById[a.task_id];
      return `<div class="item"><a class="link" href="#artifact/${a.id}">${esc(a.title)}</a>
        <div class="meta">${fmt(a.created_at)}${t ? `・${esc(dept(t.department_key))}` : ""}</div></div>`;
    }, "まだありません"),
    data.artifacts.length,
  );
}

async function viewArtifact(id) {
  const [a] = await rows(db.from("artifacts").select("id,task_id,title,content,created_at").eq("id", id).limit(1), "artifacts");
  if (!a) return card("成果物", `<div class="empty">見つかりません</div>`);
  const [r] = await rows(db.from("dept_reports").select("did,findings,issues,proposals").eq("task_id", a.task_id).limit(1), "dept_reports");
  const summary = r
    ? card("要点", `<div class="md">${md(`**やったこと**\n\n${r.did}\n\n**分かったこと**\n\n${r.findings}` +
        (r.issues ? `\n\n**問題**\n\n${r.issues}` : "") + (r.proposals ? `\n\n**提案**\n\n${r.proposals}` : ""))}</div>`)
    : "";
  return `<p><a class="link" href="#kdp">← KDPに戻る</a></p>` +
    card(a.title, `<div class="meta small">${fmt(a.created_at)}</div>`) + summary +
    card("本文", `<div class="md">${md(a.content)}</div>`);
}

function viewHistory(sub = "reports") {
  const seg = [["reports", "朝の報告"], ["decisions", "CEOの判断"], ["instructions", "ボスの指示"], ["tasks", "仕事"], ["notices", "通知"], ["production", "制作担当"], ["policy", "方針・事業"]];
  const nav = `<div class="segment">${seg.map(([k, l]) => `<a href="#history/${k}" class="${k === sub ? "active" : ""}">${l}</a>`).join("")}</div>`;
  let body = "";
  if (sub === "reports") {
    body = card("朝の報告", list(data.reports, (r) => `<details class="item"><summary>${esc(r.report_date)}${r.delivery_error ? "（送信失敗）" : ""}</summary><pre class="report">${esc(r.rendered)}</pre></details>`, "まだありません"));
  } else if (sub === "decisions") {
    body = card("CEOが決めたこと", list(data.decisions, (d) => `<div class="item">${esc(d.summary)}<div class="meta">${fmt(d.created_at)}・理由：${esc(d.rationale)}</div></div>`));
  } else if (sub === "instructions") {
    body = card("ボスの指示とCEOの理解", list(data.instructions, (i) => `<details class="item"><summary><span class="pill">${INSTR_STATUS[i.status] ?? i.status}</span>${fmt(i.created_at)} ${esc(i.body.slice(0, 40))}…</summary>
      <pre class="report">${esc(i.body)}</pre>${i.ceo_interpretation ? `<div class="md"><p><b>CEOの理解</b></p>${md(i.ceo_interpretation)}</div>` : ""}</details>`));
  } else if (sub === "tasks") {
    body = card("最近の仕事", list(data.recentTasks, (t) => `<div class="item"><span class="pill">${TASK_STATUS[t.status] ?? t.status}</span>${esc(t.title)}
      <div class="meta">${fmt(t.created_at)}・${esc(dept(t.department_key))}${t.last_error ? `・${esc(t.last_error.slice(0, 140))}` : ""}</div></div>`));
  } else if (sub === "notices") {
    body = card("LINEへの通知", list(data.notifications, (n) => `<details class="item"><summary><span class="pill">${n.kind === "alert" ? "お知らせ" : "CEOの返信"}</span>${fmt(n.created_at)}${n.delivered ? "" : "（未配信）"}</summary><pre class="report">${esc(n.body)}</pre></details>`));
  } else if (sub === "production") {
    body = card("制作担当からの報告（CEOに共有済み）", list(data.productionUpdates, (u) => `<div class="item">${esc(u.body)}<div class="meta">${fmt(u.created_at)}</div></div>`, "まだありません"));
  } else if (sub === "policy") {
    body =
      card("事業", list(data.businesses, (b) => `<details class="item"><summary>${esc(b.name)}（${b.status === "active" ? "進行中" : esc(b.status)}）</summary><pre class="report">${esc(b.description)}\n\n目標：${esc(b.kpi)}</pre></details>`)) +
      card("有効な方針", list(data.policies, (p) => `<details class="item"><summary>${esc(p.title)} v${p.version}</summary><pre class="report">${esc(p.body)}</pre></details>`));
  }
  return nav + body;
}

function viewCost() {
  const now = data.now;
  const b = budget();
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const start = jstDayStart(new Date(now.getTime() - i * 86400e3));
    const end = new Date(start.getTime() + 86400e3);
    const v = data.usage.filter((u) => { const t = new Date(u.created_at); return t >= start && t < end; }).reduce((a, u) => a + Number(u.cost_yen), 0);
    days.push({ label: jstDate(start).slice(8), v });
  }
  const max = Math.max(b.dailyCap, ...days.map((d) => d.v));
  const chart = `<div class="chart">${days.map((d) => `<div style="height:${(d.v / max) * 100}%" title="${yen(d.v)}"></div>`).join("")}</div>
    <div class="chart-labels">${days.map((d) => `<span>${Number(d.label)}</span>`).join("")}</div>
    <div class="small muted">棒の高さの上端＝1日の上限 ${yen(b.dailyCap)}</div>`;

  const monthStart = jstMonthStart(now);
  const monthRows = data.usage.filter((u) => new Date(u.created_at) >= monthStart);
  const byPurpose = {};
  for (const u of monthRows) byPurpose[u.purpose] = (byPurpose[u.purpose] || 0) + Number(u.cost_yen);
  const month = monthRows.reduce((a, u) => a + Number(u.cost_yen), 0);
  const waste = monthRows.filter((u) => u.ok === false).reduce((a, u) => a + Number(u.cost_yen), 0);
  const searches = monthRows.reduce((a, u) => a + (u.web_searches || 0), 0);
  const c = credit();

  return (
    card("事業部ごとの今月の費用", bizBar("kdp") + bizBar("threads") + bizBar("company") +
      `<div class="small muted">事業部ごとに上限があり、超えるとその事業部のAIだけが止まります</div>`) +
    card("直近14日の費用（AI）", chart) +
    card("今月", `<div class="row"><span>使った額</span><span>${yen(month)} / ${yen(b.monthLimit)}</span></div>
      <div class="row"><span>失敗でムダになった額</span><span>${yen(waste)}</span></div>
      <div class="row"><span>Web検索の回数</span><span>${searches}回</span></div>` +
      Object.entries(byPurpose).sort((x, y) => y[1] - x[1]).map(([k, v]) => `<div class="row"><span>${esc(PURPOSE[k] ?? k)}</span><span>${yen(v)}</span></div>`).join("")) +
    (c ? card("Claude APIの残高（計算上）", `<div class="row"><span>残高</span><span>約$${c.remainingUsd.toFixed(2)}</span></div>
      <div class="row"><span>最近の使用ペース</span><span>1日 約$${c.burnUsd.toFixed(2)}</span></div>
      <div class="row"><span>あと</span><span>約${Math.floor(c.daysLeft)}日分</span></div>
      <div class="small muted">Consoleの表示とずれたら、LINEで「残高 25.5」のように送ると合わせられます</div>`) : "") +
    card("月の上限", `<div class="row"><span>運用費の上限（会社全体）</span><span>${yen(b.cap)}</span></div>
      <div class="small muted">ボスが決めた最大は${yen(ABSOLUTE_CAP)}。上げるときは事前に確認します</div>
      <div class="row"><span>AIに使える上限</span><span>${yen(b.monthLimit)}</span></div>
      <div class="row"><span>1日の上限</span><span>${yen(b.dailyCap)}</span></div>`)
  );
}

// ---------- 画面の切り替え ----------
async function render() {
  const [tab, arg] = (location.hash.replace("#", "") || "home").split("/");
  document.querySelectorAll(".tabs a").forEach((a) => a.classList.toggle("active", a.dataset.tab === (tab === "artifact" || tab === "artifacts" ? "kdp" : tab)));
  const view = $("#view");
  try {
    if (!data) await load();
    if (tab === "kdp") view.innerHTML = viewKdp();
    else if (tab === "sumaho") view.innerHTML = viewSumaho();
    else if (tab === "artifacts") view.innerHTML = viewArtifacts();
    else if (tab === "artifact") view.innerHTML = await viewArtifact(arg);
    else if (tab === "history") view.innerHTML = viewHistory(arg);
    else if (tab === "cost") view.innerHTML = viewCost();
    else view.innerHTML = viewHome();
  } catch (e) {
    view.innerHTML = card("読み込めませんでした", `<div class="error">${esc(e.message)}</div><div class="small muted">ログインし直すか、少し待ってから「更新」を押してください</div>`);
  }
  window.scrollTo(0, 0);
}

async function refresh() {
  data = null;
  $("#updated").textContent = "読み込み中…";
  await render();
}

async function showApp() {
  $("#login").hidden = true;
  $("#app").hidden = false;
  await refresh();
}

function showLogin() {
  $("#app").hidden = true;
  $("#login").hidden = false;
}

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#loginError");
  err.hidden = true;
  const { error } = await db.auth.signInWithPassword({ email: $("#email").value.trim(), password: $("#password").value });
  if (error) {
    err.textContent = "ログインできませんでした。メールアドレスとパスワードを確認してください。";
    err.hidden = false;
    return;
  }
  $("#password").value = "";
  await showApp();
});
$("#logout").addEventListener("click", async () => {
  await db.auth.signOut();
  data = null;
  showLogin();
});
$("#refresh").addEventListener("click", refresh);
window.addEventListener("hashchange", render);
document.addEventListener("visibilitychange", () => {
  // しばらく閉じていた画面を開き直したら、最新の記録を読み直す
  if (document.visibilityState === "visible" && data && Date.now() - data.now.getTime() > 5 * 60e3) refresh();
});

(async () => {
  const { data: s } = await db.auth.getSession();
  if (s.session) await showApp();
  else showLogin();
})();
