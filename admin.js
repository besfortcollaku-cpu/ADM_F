const API_BASE = "https://triumphant-gentleness-production.up.railway.app";
let ADMIN_SECRET = sessionStorage.getItem("ADMIN_SECRET");

let usersOffset = 0;
const usersLimit = 25;
let lastUsersCount = 0;
let selectedUid = null;
let selectedUser = null; // cache from /admin/users/:uid response

let onlineTimer = null;

let payoutLoading = false;
let payoutLastRefreshAt = null;
let payoutJobsOffset = 0;
const payoutJobsLimit = 20;
let payoutJobsCount = 0;
let payoutSelectedMonthKey = "";

function nowTime() { return new Date().toLocaleTimeString(); }

function setStatus(txt) {
  const t = txt + " · " + nowTime();
  const el = document.getElementById("statusText");
  if (el) el.textContent = t;
  const el2 = document.getElementById("statusTextTop");
  if (el2) el2.textContent = t;
}
function setStatusTone(kind){
  const el = document.getElementById("statusText");
  const el2 = document.getElementById("statusTextTop");
  [el, el2].forEach(x=>{
    if(!x) return;
    x.style.borderColor = kind==="ok" ? "#2a57b8" : kind==="err" ? "#5a2330" : "#223056";
    x.style.background = kind==="ok" ? "#17305f" : kind==="err" ? "#1a0f12" : "#101c36";
  });
}

function setDetailMeta(txt) {
  const el = document.getElementById("detailMeta");
  if (el) el.textContent = txt;
}

function formatMaybe(value) {
  return value == null || value === "" ? "–" : String(value);
}

function warningPill(label, active) {
  return `<span class="pill adminWarningPill ${active ? "is-active" : ""}">${escapeHtml(label)}</span>`;
}

function renderEconomyHealth(stats) {
  const summaryEl = document.getElementById("economyHealthSummary");
  const warningsEl = document.getElementById("economyHealthWarnings");
  const stateEl = document.getElementById("economyHealthState");
  if (!summaryEl || !warningsEl || !stateEl) return;

  if (!stats) {
    stateEl.textContent = "Unavailable";
    summaryEl.innerHTML = `<div class="muted">Economy health unavailable.</div>`;
    warningsEl.innerHTML = "";
    return;
  }

  const item = (label, value) => `<div class="hrow" style="margin:6px 0"><span class="muted">${label}</span><span class="spacer"></span><span>${escapeHtml(formatMaybe(value))}</span></div>`;
  const warnings = [
    warningPill("Duplicate risk", !!stats.duplicateSettlementRisk),
    warningPill("Pool mismatch", !!stats.poolMismatchWarning),
    warningPill("Orphan rows", !!stats.orphanPayoutRowsWarning),
  ];
  const hasWarning = !!stats.duplicateSettlementRisk || !!stats.poolMismatchWarning || !!stats.orphanPayoutRowsWarning;

  stateEl.textContent = hasWarning ? "Warning" : "Healthy";
  stateEl.style.borderColor = hasWarning ? "#5a2330" : "#2a57b8";
  stateEl.style.background = hasWarning ? "#2a1419" : "#17305f";

  summaryEl.innerHTML = [
    item("Current Month", stats.currentMonthKey),
    item("Season Pool", stats.currentSeasonPool),
    item("Users With Score", stats.totalUsersWithScore),
    item("Payout Eligible Users", stats.payoutEligibleUsers),
    item("Current Score Total", stats.totalCurrentScore),
    item("Current Payout Rows", stats.currentMonthPayoutRows),
    item("Settlement Status", stats.settlementStatus),
    item("Already Settled", stats.alreadySettledCurrentMonth ? "YES" : "NO"),
    item("Last Settled Month", stats.lastSettlementMonthKey),
    item("Last Settlement Payout", stats.lastSettlementTotalPayoutPi),
    item("Users At Daily Cap", stats.usersAtDailyCap),
    item("Score But Not Eligible", stats.usersWithScoreButNotEligible),
    item("Manual Score Adjustments", stats.manualScoreAdjustmentsThisMonth),
    item("Manual Coins Adjustments", stats.manualCoinsAdjustmentsThisMonth),
  ].join("");

  warningsEl.innerHTML = warnings.join("");
}

function setOnlineAuto(on){
  const el = document.getElementById("onlineAuto");
  if (!el) return;
  el.textContent = "Auto: " + (on ? "ON" : "OFF");
  el.style.borderColor = on ? "#2a57b8" : "#223056";
  el.style.background = on ? "#17305f" : "#101c36";
}

function toast(msg, ms=2200) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.style.display = "block";
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.style.display = "none"; }, ms);
}

function requireSecret(force=false) {
  if (force) {
    sessionStorage.removeItem("ADMIN_SECRET");
    ADMIN_SECRET = null;
  }
  if (!ADMIN_SECRET) {
    ADMIN_SECRET = prompt("Enter admin secret:");
    if (!ADMIN_SECRET) {
      alert("Admin secret required");
      throw new Error("No admin secret");
    }
    sessionStorage.setItem("ADMIN_SECRET", ADMIN_SECRET);
  }
}

async function adminFetch(path, retryOn401=true) {
  requireSecret();

  const res = await fetch(API_BASE + path, {
    method: "GET",
    headers: { "x-admin-secret": ADMIN_SECRET }
  });

  const txt = await res.text().catch(()=> "");

  if (res.status === 401 && retryOn401) {
    try {
      requireSecret(true);
      return await adminFetch(path, false);
    } catch {}
  }

  if (!res.ok) {
    throw new Error("Admin request failed: " + res.status + " " + (txt || "(no body)"));
  }
  try { return JSON.parse(txt); } catch { return { ok:true, raw: txt }; }
}

async function adminSend(method, path, body, retryOn401=true) {
  requireSecret();

  const res = await fetch(API_BASE + path, {
    method,
    headers: {
      "x-admin-secret": ADMIN_SECRET,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : "{}"
  });

  const txt = await res.text().catch(()=> "");

  if (res.status === 401 && retryOn401) {
    try {
      requireSecret(true);
      return await adminSend(method, path, body, false);
    } catch {}
  }

  if (!res.ok) throw new Error("Admin request failed: " + res.status + " " + (txt || "(no body)"));
  try { return JSON.parse(txt); } catch { return { ok:true, raw: txt }; }
}

function showView(which) {
  document.querySelectorAll("section[id^='view-']").forEach(s => s.classList.add("hidden"));
  const view = document.getElementById("view-" + which);
  if (view) view.classList.remove("hidden");

  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  const tab = document.getElementById("tab-" + which);
  if (tab) tab.classList.add("active");

  if (which === "online") startOnlineAuto();
  else stopOnlineAuto();

  closeSidebar();
}

/* USERS */
function setDetailEnabled(on) {
  const ids = [
    "btn-copy-uid",
    "btn-copy-username",
    "coinsDelta",
    "btn-coins-add",
    "coinsSet",
    "btn-coins-set",
    "scoreDelta",
    "btn-score-adjust",
    "scoreSet",
    "btn-score-set",
    "btn-coins-reset",
    "btn-reset-free",
    "btn-mark-test-user",
    "btn-unmark-test-user",
    "btn-detail-refresh",
    "btn-user-reset",
    "btn-user-delete",
    "btn-fraud-recompute",
    "btn-force-manual-review",
    "btn-clear-suspicious",
    "btn-unlock-payout"
  ];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.disabled = !on;
  });
  const resetHint = document.getElementById("resetUserHint");
  if (resetHint && !on) resetHint.textContent = "Reset is only available for test users.";
  if (!on) setDetailMeta("No user selected");
}

function userRowHTML(u) {
  const updated = (u.updated_at || "").toString().replace("T"," ").replace("Z","");
  const uid = String(u.uid || "");
  const isSel = selectedUid && selectedUid === uid;
  return `
    <tr data-uid="${escapeHtml(uid)}" class="${isSel ? "selected" : ""}">
      <td>${escapeHtml(u.username || "")}</td>
      <td class="mono">${escapeHtml(uid)}</td>
      <td>${getUserCoins(u)}</td>
      <td>${getUserScore(u)}</td>
      <td>${getUserDailyScore(u)}</td>
      <td>${num(u.free_skips_used)}</td>
      <td>${num(u.free_hints_used)}</td>
      <td>${escapeHtml(getUserRiskSummary(u))}</td>
      <td class="mono">${escapeHtml(maskWallet(u.pi_wallet_identifier))}</td>
      <td class="muted">${escapeHtml(updated)}</td>
    </tr>
  `;
}

function setUsersMeta(count) {
  const meta = document.getElementById("usersMeta");
  if (!meta) return;
  if (!count) return (meta.textContent = "0 users");
  const start = Math.min(count, usersOffset + 1);
  const end = Math.min(count, usersOffset + usersLimit);
  meta.textContent = `Showing ${start}–${end} of ${count}`;
}

function renderUserDetail(d) {
  const u = d?.user || {};
  const p = d?.progress || null;
  const s = d?.stats || {};
  const ls = d?.last_session || null;
  const payoutRows = d?.recent_payout_rows || d?.payout_rows || d?.recentPayoutRows || null;
  const rewardRows = d?.recent_reward_rows || d?.reward_rows || d?.recentRewardRows || null;
  const currentRank = getCurrentRank(u);

  const parts = [];
  parts.push(`<div class="hrow">
    <div>
      <div style="font-weight:800;font-size:18px">${escapeHtml(u.username || "-")}</div>
      <div class="muted mono">${escapeHtml(u.uid || "")}</div>
    </div>
    <div class="spacer"></div>
    ${isTestUser(u) ? `<div class="pill testUserBadge">Test User</div>` : ""}
    <div class="pill">Coins: <b>${getUserCoins(u)}</b></div>
    <div class="pill">Score: <b>${getUserScore(u)}</b></div>
  </div>`);
  parts.push(`<div class="divider"></div>`);

  parts.push(`<div class="grid" style="grid-template-columns:repeat(2,minmax(160px,1fr));margin:0">
    <div class="card" style="padding:12px">
      <div class="kpi-title">Daily Score</div>
      <div class="kpi-value" style="font-size:22px">${getUserDailyScore(u)}</div>
      <div class="kpi-sub">Current season daily Score</div>
    </div>
    <div class="card" style="padding:12px">
      <div class="kpi-title">Projected Tier</div>
      <div class="kpi-value" style="font-size:22px">${escapeHtml(getProjectedTier(u))}</div>
      <div class="kpi-sub">${currentRank ? `Rank #${currentRank}` : "Rank -"}</div>
    </div>
  </div>`);

  parts.push(`<div class="divider"></div>`);
  parts.push(`<div class="muted">Economy</div>
    <div class="hrow" style="margin:6px 0"><span class="muted">Coins</span><span class="spacer"></span><span>${getUserCoins(u)}</span></div>
    <div class="hrow" style="margin:6px 0"><span class="muted">Score</span><span class="spacer"></span><span>${getUserScore(u)}</span></div>
    <div class="hrow" style="margin:6px 0"><span class="muted">Daily Score</span><span class="spacer"></span><span>${getUserDailyScore(u)}</span></div>
    <div class="hrow" style="margin:6px 0"><span class="muted">Current Rank</span><span class="spacer"></span><span>${currentRank ? "#" + currentRank : "-"}</span></div>
    <div class="hrow" style="margin:6px 0"><span class="muted">Projected Tier</span><span class="spacer"></span><span>${escapeHtml(getProjectedTier(u))}</span></div>
    <div class="hrow" style="margin:6px 0"><span class="muted">Test User</span><span class="spacer"></span><span>${isTestUser(u) ? "YES" : "-"}</span></div>
    <div class="hrow" style="margin:6px 0"><span class="muted">Wallet</span><span class="spacer"></span><span class="mono">${escapeHtml(maskWallet(u.pi_wallet_identifier))}</span></div>
  `);

  parts.push(`<div class="divider"></div>`);
  parts.push(`<div class="muted">Gameplay</div>
    <div class="hrow" style="margin:6px 0"><span class="muted">Free Skips Used</span><span class="spacer"></span><span>${num(u.free_skips_used)}</span></div>
    <div class="hrow" style="margin:6px 0"><span class="muted">Free Hints Used</span><span class="spacer"></span><span>${num(u.free_hints_used)}</span></div>
    <div class="hrow" style="margin:6px 0"><span class="muted">Ads Watched Today</span><span class="spacer"></span><span>${num(u.ads_watched_today)}</span></div>
  `);

  parts.push(`<div class="divider"></div>`);
  parts.push(`<div class="muted">Risk</div>
    <div class="hrow" style="margin:6px 0"><span class="muted">Fraud Score</span><span class="spacer"></span><span>${num(u.fraud_score)}</span></div>
    <div class="hrow" style="margin:6px 0"><span class="muted">VPN Flag</span><span class="spacer"></span><span>${u.vpn_flag ? "YES" : "NO"}</span></div>
    <div class="hrow" style="margin:6px 0"><span class="muted">Suspicious</span><span class="spacer"></span><span>${u.suspicious ? "YES" : "NO"}</span></div>
    <div class="hrow" style="margin:6px 0"><span class="muted">Manual Review Required</span><span class="spacer"></span><span>${u.manual_review_required ? "YES" : "NO"}</span></div>
    <div class="hrow" style="margin:6px 0"><span class="muted">Payout Locked</span><span class="spacer"></span><span>${u.payout_locked ? "YES" : "NO"}</span></div>
    <div class="muted">Risk Flags</div>
    <pre class="mono">${escapeHtml(JSON.stringify(u.risk_flags || [], null, 2))}</pre>
  `);

  if (payoutRows) {
    parts.push(`<div class="divider"></div>
      <details class="adminRawBlock">
        <summary>Recent payout rows</summary>
        <pre class="mono">${escapeHtml(JSON.stringify(payoutRows, null, 2))}</pre>
      </details>`);
  }

  if (rewardRows) {
    parts.push(`<div class="divider"></div>
      <details class="adminRawBlock">
        <summary>Recent activity rows</summary>
        <pre class="mono">${escapeHtml(JSON.stringify(rewardRows, null, 2))}</pre>
      </details>`);
  }

  parts.push(`<div class="divider"></div>
    <details class="adminRawBlock">
      <summary>Raw detail</summary>
      <div class="muted">Progress</div>
      <pre class="mono">${escapeHtml(JSON.stringify(p, null, 2))}</pre>
      <div class="muted">User stats</div>
      <pre class="mono">${escapeHtml(JSON.stringify(s, null, 2))}</pre>
      <div class="muted">Last session</div>
      <pre class="mono">${escapeHtml(JSON.stringify(ls, null, 2))}</pre>
    </details>
  `);
  return parts.join("");
}

function updateDetailTestUserControls() {
  const user = selectedUser?.user || {};
  const flagged = isTestUser(user);
  const resetBtn = document.getElementById("btn-user-reset");
  const markBtn = document.getElementById("btn-mark-test-user");
  const unmarkBtn = document.getElementById("btn-unmark-test-user");
  const hintEl = document.getElementById("resetUserHint");

  if (resetBtn) resetBtn.disabled = !selectedUid || !flagged;
  if (markBtn) markBtn.disabled = !selectedUid || flagged;
  if (unmarkBtn) unmarkBtn.disabled = !selectedUid || !flagged;
  if (hintEl) {
    hintEl.textContent = flagged
      ? "Reset is enabled for this test user."
      : "Reset is only available for test users.";
  }
}

async function loadUsers(reset=false) {
  try {
    setStatus("Loading users…");
    if (reset) usersOffset = 0;

    try {
      const statsOut = await adminFetch("/admin/stats?minutes=5");
      renderEconomyHealth(statsOut?.data || statsOut || null);
    } catch {
      renderEconomyHealth(null);
    }

    const q = document.getElementById("usersSearch").value.trim();
    const order = document.getElementById("usersOrder").value;
    const suspiciousOnly = document.getElementById("usersOnlySuspicious")?.checked ? "1" : "0";
    const vpnOnly = document.getElementById("usersOnlyVpn")?.checked ? "1" : "0";
    const manualReviewOnly = document.getElementById("usersOnlyManualReview")?.checked ? "1" : "0";
    const payoutLockedOnly = document.getElementById("usersOnlyPayoutLocked")?.checked ? "1" : "0";

    const url = "/admin/users"
      + "?search=" + encodeURIComponent(q)
      + "&limit=" + encodeURIComponent(usersLimit)
      + "&offset=" + encodeURIComponent(usersOffset)
      + "&order=" + encodeURIComponent(order)
      + "&suspicious=" + encodeURIComponent(suspiciousOnly)
      + "&vpn=" + encodeURIComponent(vpnOnly)
      + "&manual_review=" + encodeURIComponent(manualReviewOnly)
      + "&payout_locked=" + encodeURIComponent(payoutLockedOnly);

    const out = await adminFetch(url);
    const rows = out?.rows || [];
    const count = Number(out?.count ?? 0);
    lastUsersCount = count;

    if (count > 0 && usersOffset >= count) {
      usersOffset = Math.max(0, Math.floor((count - 1) / usersLimit) * usersLimit);
      return loadUsers(false);
    }

    const tbody = document.getElementById("usersTbody");
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="10" class="muted">No users found.</td></tr>`;
      selectedUid = null;
      selectedUser = null;
      setDetailEnabled(false);
      document.getElementById("userDetail").innerHTML = `<div class="muted">Click a user row to load details.</div>`;
      setDetailMeta("No user selected");
    } else {
      tbody.innerHTML = rows.map(userRowHTML).join("");
    }

    setUsersMeta(count);

    tbody.querySelectorAll("tr[data-uid]").forEach(tr => {
      tr.addEventListener("click", async () => {
        tbody.querySelectorAll("tr").forEach(x => x.classList.remove("selected"));
        tr.classList.add("selected");

        const uid = tr.getAttribute("data-uid");
        if (!uid) return;

        selectedUid = uid;
        setDetailMeta("Selected: " + uid);
        await loadUserDetail(uid);
      });
    });

    setStatus("OK");
  } catch (e) {
    console.error(e);
    document.getElementById("usersTbody").innerHTML =
      `<tr><td colspan="10" class="danger">Error: ${escapeHtml(e?.message || String(e))}</td></tr>`;
    setUsersMeta(0);
    setStatus("Error");
  }
}

async function loadUserDetail(uid) {
  try {
    setStatus("Loading user…");
    setDetailEnabled(false);
    selectedUser = null;

    const out = await adminFetch("/admin/users/" + encodeURIComponent(uid));
    const d = out?.data || out;

    selectedUser = d;
    const username = d?.user?.username ? String(d.user.username) : "";
    setDetailMeta(username ? `Selected: ${username}` : `Selected: ${uid}`);

    document.getElementById("userDetail").innerHTML = renderUserDetail(d);
    setDetailEnabled(true);
    updateDetailTestUserControls();

    setStatus("OK");
  } catch (e) {
    console.error(e);
    document.getElementById("userDetail").innerHTML =
      `<span class="danger">Error: ${escapeHtml(e?.message || String(e))}</span>`;
    setDetailEnabled(false);
    setStatus("Error");
  }
}

/* ONLINE */
function onlineRowHTML(r) {
  const lastSeen = (r.last_seen_at || "").toString().replace("T"," ").replace("Z","");
  const started = (r.started_at || "").toString().replace("T"," ").replace("Z","");
  return `
    <tr>
      <td>${escapeHtml(r.username || "")}</td>
      <td class="mono">${escapeHtml(r.uid || "")}</td>
      <td>${getUserCoins(r)}</td>
      <td class="muted">${escapeHtml(lastSeen)}</td>
      <td class="muted">${escapeHtml(started)}</td>
      <td class="muted">${escapeHtml((r.user_agent || "").slice(0,120))}</td>
    </tr>
  `;
}

async function loadOnline() {
  try {
    setStatus("Loading online…");
    const minutes = Math.max(1, Number(document.getElementById("onlineMinutes").value || 5));
    const out = await adminFetch("/admin/online?minutes=" + encodeURIComponent(minutes) + "&limit=50&offset=0");
    const rows = out?.rows || [];
    const count = Number(out?.count ?? rows.length);

    const tbody = document.getElementById("onlineTbody");
    tbody.innerHTML = rows.length
      ? rows.map(onlineRowHTML).join("")
      : `<tr><td colspan="6" class="muted">No online users in last ${minutes} minutes.</td></tr>`;

    document.getElementById("onlineMeta").textContent = `${count} online (window ${minutes}m)`;
    setStatus("OK");
  } catch (e) {
    console.error(e);
    document.getElementById("onlineTbody").innerHTML =
      `<tr><td colspan="13" class="danger">Error: ${escapeHtml(e?.message || String(e))}</td></tr>`;
    document.getElementById("onlineMeta").textContent = "–";
    setStatus("Error");
  }
}

function startOnlineAuto(){
  if (onlineTimer) return;
  setOnlineAuto(true);
  onlineTimer = setInterval(() => {
    const active = document.querySelector(".tab.active")?.id || "";
    if (active === "tab-online") loadOnline();
  }, 15000);
}

function stopOnlineAuto(){
  if (onlineTimer){
    clearInterval(onlineTimer);
    onlineTimer = null;
  }
  setOnlineAuto(false);
}

/* HELPERS */
function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}
function maskWallet(v) {
  const s = String(v || "").trim();
  if (!s) return "-";
  if (s.length <= 12) return s;
  return s.slice(0, 6) + "..." + s.slice(-4);
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function getUserCoins(u) {
  return num(u?.mc_balance ?? u?.coins);
}

function getUserScore(u) {
  return num(u?.rp_score ?? u?.score ?? u?.rpScore);
}

function getUserDailyScore(u) {
  return num(u?.daily_rp ?? u?.dailyScore ?? u?.dailyRp);
}

function getProjectedTier(u) {
  return String(u?.projectedTierLabel ?? u?.projected_tier_label ?? u?.projectedTierName ?? u?.projected_tier_name ?? u?.tier_label ?? u?.tier_name ?? "").trim() || "-";
}

function getCurrentRank(u) {
  const value = u?.currentRank ?? u?.current_rank ?? u?.rank ?? null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function isTestUser(u) {
  return Boolean(u?.isTestUser ?? u?.is_test_user);
}

function getUserRiskSummary(u) {
  const flags = [];
  if (u?.payout_locked) flags.push("locked");
  if (u?.manual_review_required) flags.push("manual");
  if (u?.suspicious) flags.push("suspicious");
  if (u?.vpn_flag) flags.push("vpn");
  if (num(u?.fraud_score) > 0) flags.push(`fraud:${num(u?.fraud_score)}`);
  return flags.length ? flags.join(", ") : "ok";
}

async function refreshUsersAndDetail() {
  await loadUsers(false);
  if (selectedUid) await loadUserDetail(selectedUid);
}


/* PAYOUTS */
function statusBadge(status) {
  const s = String(status || "").toLowerCase();
  const cls = ["status-badge", "status-" + s.replace(/\s+/g, "_")].join(" ");
  return `<span class="${cls}">${escapeHtml(status || "-")}</span>`;
}

function formatIso(ts) {
  if (!ts) return "-";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  return d.toLocaleString();
}

function txidCell(txid) {
  if (!txid) return "-";
  const t = String(txid);
  return `<a class="mono" href="#" title="Blockchain TX" onclick="return false;">Blockchain TX</a><div class="muted mono">${escapeHtml(t)}</div>`;
}

function normalizeSettlementResponse(data) {
  const payload = data?.data || data || {};
  return {
    monthKey: payload.monthKey || payload.month_key || payload.month || "-",
    status: payload.status || "-",
    alreadySettled: payload.alreadySettled === true || payload.already_settled === true,
    poolPi: payload.poolPi ?? payload.totalPoolPi ?? payload.pool_pi ?? null,
    eligibleUsers: payload.eligibleUsers ?? payload.eligible_users ?? null,
    totalScore: payload.totalScore ?? payload.totalRp ?? payload.total_score ?? null,
    payoutRowCount: payload.payoutRowCount ?? payload.payoutsCreated ?? payload.count ?? null,
    totalPayoutPi: payload.totalPayoutPi ?? payload.totalProjectedPayoutPi ?? payload.total_payout_pi ?? null,
    tierSummary: Array.isArray(payload.tierSummary) ? payload.tierSummary : [],
    rows: Array.isArray(payload.projectedPayoutRows) ? payload.projectedPayoutRows
      : Array.isArray(payload.payoutRows) ? payload.payoutRows
      : Array.isArray(payload.rows) ? payload.rows
      : [],
  };
}

function getSettlementRows(data) {
  return normalizeSettlementResponse(data).rows || [];
}

function getTierSummary(data) {
  return normalizeSettlementResponse(data).tierSummary || [];
}

function renderSettlementStateMessage(summary) {
  if (!summary) return "No settlement data yet.";
  if (summary.alreadySettled) return "Settled";
  if (String(summary.status || "").toLowerCase() === "preview") return "Preview";
  if (String(summary.status || "").toLowerCase() === "completed" || String(summary.status || "").toLowerCase() === "closed") return "Settled";
  return "Ready";
}

function setPayoutActionState(text, tone) {
  const el = document.getElementById("payoutActionState");
  if (!el) return;
  el.textContent = text;
  if (tone === "ok") {
    el.style.background = "#17305f";
    el.style.borderColor = "#2a57b8";
  } else if (tone === "err") {
    el.style.background = "#1a0f12";
    el.style.borderColor = "#5a2330";
  } else {
    el.style.background = "var(--panel2)";
    el.style.borderColor = "var(--border2)";
  }
}

function setPayoutLoading(on) {
  payoutLoading = !!on;
  [
    "btn-payout-preview",
    "btn-payout-status",
    "btn-payout-run",
    "btn-payout-run-worker",
    "btn-payout-refresh",
    "btn-payout-filter-apply",
    "btn-payout-retry-failed",
    "btn-payout-jobs-prev",
    "btn-payout-jobs-next",
    "btn-payout-sim-on",
    "btn-payout-sim-off",
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !!on;
  });
}

function setPayoutJobsMeta() {
  const el = document.getElementById("payoutJobsMeta");
  if (!el) return;
  if (!payoutJobsCount) {
    el.textContent = "0 jobs";
    return;
  }
  const start = Math.min(payoutJobsCount, payoutJobsOffset + 1);
  const end = Math.min(payoutJobsCount, payoutJobsOffset + payoutJobsLimit);
  el.textContent = `Showing ${start}–${end} of ${payoutJobsCount}`;
}

function renderPayoutCycles(rows) {
  const tbody = document.getElementById("payoutCyclesTbody");
  if (!tbody) return;
  if (!Array.isArray(rows) || rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="muted">No season settlements yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${escapeHtml(r.month_key || "-")}</td>
      <td>${escapeHtml(String(r.pool_pi ?? r.conversion_rate_locked ?? "-"))}</td>
      <td>${escapeHtml(String(r.min_payout_threshold_pi ?? "-"))}</td>
      <td>${statusBadge(r.status)}</td>
      <td class="muted">${escapeHtml(formatIso(r.created_at))}</td>
      <td class="muted">${escapeHtml(formatIso(r.closed_at))}</td>
      <td>${escapeHtml(String(r.total_users ?? 0))}</td>
      <td>${escapeHtml(String(r.total_payout_pi ?? 0))}</td>
      <td><button class="btn3 mini" data-cycle-month="${escapeHtml(r.month_key || "")}">View cycle details</button></td>
    </tr>
  `).join("");

  tbody.querySelectorAll("button[data-cycle-month]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const mk = btn.getAttribute("data-cycle-month") || "";
      const monthInput = document.getElementById("payoutMonthKey");
      const filterMonth = document.getElementById("payoutFilterMonth");
      if (monthInput) monthInput.value = mk;
      if (filterMonth) filterMonth.value = mk;
      payoutSelectedMonthKey = mk;
      payoutJobsOffset = 0;
      await loadPayouts();
    });
  });
}

function renderPayoutSummary(summary) {
  const el = document.getElementById("payoutSummary");
  if (!el) return;
  if (!summary) {
    el.innerHTML = `<div class="muted">No summary yet.</div>`;
    return;
  }

  const item = (label, value) => `<div class="hrow" style="margin:6px 0"><span class="muted">${label}</span><span class="spacer"></span><span>${escapeHtml(String(value ?? 0))}</span></div>`;
  el.innerHTML = [
    item("Payout Rows", summary.total_users_snapshotted),
    item("Eligible Users", summary.eligible_count),
    item("Below Threshold", summary.below_threshold_count),
    item("Queued Jobs", summary.queued_count),
    item("Paid", summary.paid_count),
    item("Failed", summary.failed_count),
    item("Total Payout Pi", summary.total_payout_pi_amount),
    item("Tier Summary", summary.tier_summary ?? "–"),
  ].join("");
}

function renderSettlementSummary(data) {
  const el = document.getElementById("payoutSettlementSummary");
  const stateEl = document.getElementById("payoutSettlementState");
  const runBtn = document.getElementById("btn-payout-run");
  if (!el || !stateEl) return;

  if (!data) {
    stateEl.textContent = "No settlement data yet.";
    stateEl.className = "muted";
    el.innerHTML = `<div class="muted">Select a month to preview or check settlement status.</div>`;
    if (runBtn) runBtn.disabled = false;
    return;
  }

  const summary = normalizeSettlementResponse(data);
  const item = (label, value) => `<div class="hrow" style="margin:6px 0"><span class="muted">${label}</span><span class="spacer"></span><span>${escapeHtml(String(value ?? "–"))}</span></div>`;
  const statusLower = String(summary.status || "").toLowerCase();
  stateEl.textContent = renderSettlementStateMessage(summary);
  stateEl.className = `pill payoutState ${summary.alreadySettled || statusLower === "completed" || statusLower === "closed" ? "is-settled" : statusLower === "preview" ? "is-preview" : "is-ready"}`;
  el.innerHTML = [
    item("Month", summary.monthKey || "–"),
    item("Status", summary.status || "–"),
    item("Already Settled", summary.alreadySettled ? "YES" : "NO"),
    item("Monthly Pool", summary.poolPi ?? "–"),
    item("Eligible Users", summary.eligibleUsers ?? "–"),
    item("Total Score", summary.totalScore ?? "–"),
    item("Payout Rows", summary.payoutRowCount ?? "–"),
    item("Total Payout Pi", summary.totalPayoutPi ?? "–"),
  ].join("");

  if (runBtn) runBtn.disabled = !!summary.alreadySettled || payoutLoading;
}

function renderTierSummary(data) {
  const el = document.getElementById("payoutTierSummary");
  if (!el) return;
  const tiers = getTierSummary(data);
  if (!tiers.length) {
    el.innerHTML = `<div class="muted">No tier summary yet.</div>`;
    return;
  }
  el.innerHTML = tiers.map((tier) => `
    <div class="hrow adminTierRow" style="margin:6px 0">
      <span>${escapeHtml(String(tier.tierLabel || tier.tierName || "-"))}</span>
      <span class="spacer"></span>
      <span class="muted">Users ${escapeHtml(String(tier.userCount ?? "–"))}</span>
      <span class="muted">Score ${escapeHtml(String(tier.totalScore ?? "–"))}</span>
      <span class="muted">Pool ${escapeHtml(String(tier.poolPi ?? "–"))}</span>
    </div>
  `).join("");
}

function renderSettlementPreview(data) {
  const tbody = document.getElementById("payoutPreviewTbody");
  if (!tbody) return;
  const rows = getSettlementRows(data);
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="muted">No payout rows.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map((row) => `
    <tr>
      <td>${escapeHtml(String(row.leaderboardRank ?? row.rank ?? "–"))}</td>
      <td>${escapeHtml(String(row.username || row.uid || "–"))}</td>
      <td>${escapeHtml(String(row.score ?? row.rpScore ?? "–"))}</td>
      <td>${escapeHtml(String(row.tierLabel || row.projectedTierLabel || row.tierName || row.projectedTierName || "–"))}</td>
      <td>${escapeHtml(String(row.payoutPi ?? row.payout_pi ?? "0"))}</td>
      <td>${escapeHtml(String(row.status || "preview"))}</td>
    </tr>
  `).join("");
}

function jobActionButtons(r) {
  const id = Number(r.id || 0);
  return `
    <div class="payout-actions">
      <button class="btn3 mini" data-job-requeue="${id}">Requeue</button>
      <button class="btn3 mini" data-job-resolve="${id}">Mark resolved</button>
      <button class="btn3 mini" data-job-logs="${id}">Logs</button>
    </div>
  `;
}

function renderPayoutJobs(rows) {
  const tbody = document.getElementById("payoutJobsTbody");
  if (!tbody) return;
  if (!Array.isArray(rows) || rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="17" class="muted">No settlement jobs yet.</td></tr>`;
    setPayoutJobsMeta();
    return;
  }

  const html = [];
  for (const r of rows) {
    const isFailed = ["failed", "failed_permanent", "blocked"].includes(String(r.status || ""));
    html.push(`
      <tr>
        <td class="mono">${escapeHtml(String(r.id || "-"))}</td>
        <td class="mono">${escapeHtml(r.uid || "-")}</td>
        <td>${escapeHtml(String(r.payout_pi_amount ?? "0"))}</td>
        <td>${statusBadge(r.status)}</td>
        <td>${r.flagged ? "YES" : "NO"}</td>
        <td class="mono">${escapeHtml(String(r.risk_reason || "-"))}</td>
        <td>${escapeHtml(String(r.review_status || "auto"))}</td>
        <td>${txidCell(r.txid)}</td>
        <td>${escapeHtml(String(r.external_status || "-"))}</td>
        <td>${escapeHtml(String(r.attempts ?? 0))}</td>
        <td>${r.treasury_blocked ? "YES" : "NO"}</td>
        <td>${(String(r.status || "") === "failed" || String(r.status || "") === "failed_permanent" || String(r.status || "") === "blocked") ? `<button class="btn3 mini" data-toggle-error="${Number(r.id || 0)}">View error</button>` : "-"}</td>
        <td class="muted">${escapeHtml(formatIso(r.sent_at))}</td>
        <td class="muted">${escapeHtml(formatIso(r.confirmed_at))}</td>
        <td class="muted">${escapeHtml(formatIso(r.created_at))}</td>
        <td class="muted">${escapeHtml(formatIso(r.updated_at))}</td>
        <td>${jobActionButtons(r)}</td>
      </tr>
    `);

    if (isFailed) {
      html.push(`
        <tr class="payout-row-detail hidden" id="payout-error-row-${Number(r.id || 0)}">
          <td colspan="17">
            <div class="muted">error_message</div>
            <pre class="mono payout-error-box">${escapeHtml(r.error_message || "-")}</pre>
          </td>
        </tr>
      `);
    }
  }

  tbody.innerHTML = html.join("");
  setPayoutJobsMeta();

  tbody.querySelectorAll("button[data-toggle-error]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-toggle-error");
      const row = document.getElementById("payout-error-row-" + id);
      if (row) row.classList.toggle("hidden");
    });
  });

  tbody.querySelectorAll("button[data-job-requeue]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.getAttribute("data-job-requeue") || 0);
      if (!id) return;
      await payoutAction(
        "Requeue payout job",
        `Requeue failed payout job #${id}?`,
        () => adminSend("POST", "/admin/payouts/requeue", { job_id: id })
      );
    });
  });


  tbody.querySelectorAll("button[data-job-logs]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.getAttribute("data-job-logs") || 0);
      if (!id) return;
      try {
        const out = await adminFetch("/admin/payouts/jobs/" + encodeURIComponent(id) + "/logs?limit=20");
        const payload = Array.isArray(out?.rows) ? out.rows : [];
        alert(payload.length ? JSON.stringify(payload, null, 2) : "No transfer logs yet.");
      } catch (e) {
        alert("Failed to load logs: " + (e?.message || e));
      }
    });
  });

  tbody.querySelectorAll("button[data-job-resolve]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.getAttribute("data-job-resolve") || 0);
      if (!id) return;
      await payoutAction(
        "Mark job as resolved",
        `Mark payout job #${id} as resolved?`,
        () => adminSend("POST", "/admin/payouts/jobs/" + encodeURIComponent(id) + "/resolve", {})
      );
    });
  });
}

async function loadPayouts() {
  if (payoutLoading) return;
  setPayoutLoading(true);
  setPayoutActionState("Loading...", "idle");
  try {
    const monthKeyInput = (document.getElementById("payoutMonthKey")?.value || "").trim();
    const filterMonth = (document.getElementById("payoutFilterMonth")?.value || "").trim();
    const monthKey = filterMonth || monthKeyInput || payoutSelectedMonthKey;
    payoutSelectedMonthKey = monthKey;

    const status = (document.getElementById("payoutFilterStatus")?.value || "").trim();
    const uid = (document.getElementById("payoutFilterUid")?.value || "").trim();

    const jobsQs = new URLSearchParams();
    if (monthKey) jobsQs.set("month_key", monthKey);
    if (status) jobsQs.set("status", status);
    if (uid) jobsQs.set("uid", uid);
    jobsQs.set("limit", String(payoutJobsLimit));
    jobsQs.set("offset", String(payoutJobsOffset));

    const summaryQs = monthKey ? ("?month_key=" + encodeURIComponent(monthKey)) : "";
    const jobsPath = "/admin/payouts/jobs" + (jobsQs.toString() ? ("?" + jobsQs.toString()) : "");
    const settlementStatusPath = "/admin/settlement/status" + (monthKey ? ("?month_key=" + encodeURIComponent(monthKey)) : "");

    const [cfg, cycles, summary, jobs, settlementStatus] = await Promise.all([
      adminFetch("/admin/payouts/config"),
      adminFetch("/admin/payouts/cycles?limit=12"),
      adminFetch("/admin/payouts/snapshots" + summaryQs),
      adminFetch(jobsPath),
      adminFetch(settlementStatusPath).catch(() => null),
    ]);

    const simulation = !!cfg?.simulation_mode;
    const simEl = document.getElementById("payoutSimulation");
    const simOnBtn = document.getElementById("btn-payout-sim-on");
    const simOffBtn = document.getElementById("btn-payout-sim-off");
    if (simEl) {
      simEl.textContent = "Simulation: " + (simulation ? "ON" : "OFF");
      simEl.style.borderColor = simulation ? "#2a57b8" : "#5a2330";
      simEl.style.background = simulation ? "#17305f" : "#1a0f12";
    }

    if (simOnBtn && simOffBtn) {
      simOnBtn.style.borderColor = simulation ? "#2a57b8" : "var(--border2)";
      simOnBtn.style.background = simulation ? "#17305f" : "var(--panel2)";
      simOffBtn.style.borderColor = simulation ? "var(--border2)" : "#b33d55";
      simOffBtn.style.background = simulation ? "var(--panel2)" : "#5a1d28";
    }

    const modeEl = document.getElementById("payoutModeBanner");
    if (modeEl) {
      if (simulation) {
        modeEl.textContent = "Simulation Mode Active – No real Pi transfers.";
        modeEl.style.background = "#17305f";
        modeEl.style.borderColor = "#2a57b8";
      } else {
        modeEl.textContent = "Production Mode – Real Pi transfers enabled.";
        modeEl.style.background = "#5a1d28";
        modeEl.style.borderColor = "#b33d55";
      }
    }

    renderPayoutCycles(cycles?.rows || []);
    renderPayoutSummary(summary?.summary || null);
    renderSettlementSummary(settlementStatus);
    renderTierSummary(settlementStatus);
    renderSettlementPreview(settlementStatus);
    payoutJobsCount = Number(jobs?.count || 0);
    renderPayoutJobs(jobs?.rows || []);
    setPayoutJobsMeta();

    payoutLastRefreshAt = new Date();
    const last = document.getElementById("payoutLastRefresh");
    if (last) last.textContent = "Last refresh: " + payoutLastRefreshAt.toLocaleString();

    setPayoutActionState("Ready", "ok");
    setStatus("Season settlement loaded");
    setStatusTone("ok");
  } catch (e) {
    setPayoutActionState("Error", "err");
    setStatus("Season settlement error");
    setStatusTone("err");
    toast("Season settlement load failed: " + (e?.message || String(e)), 3000);
  } finally {
    setPayoutLoading(false);
  }
}

async function payoutAction(actionName, confirmText, run) {
  if (payoutLoading) return;
  if (confirmText && !confirm(confirmText)) return;

  setPayoutLoading(true);
  setPayoutActionState(actionName + "...", "idle");

  try {
    await run();
    toast(actionName + " successful");
    setPayoutActionState(actionName + " done", "ok");
  } catch (e) {
    setPayoutActionState(actionName + " failed", "err");
    toast(actionName + " failed: " + (e?.message || String(e)), 3200);
  } finally {
    setPayoutLoading(false);
  }

  await loadPayouts();
}

/* DETAIL ACTIONS (unchanged) */
async function copyText(text, okMsg) {
  try {
    await navigator.clipboard.writeText(String(text));
    toast(okMsg || "Copied");
  } catch {
    const ta = document.createElement("textarea");
    ta.value = String(text);
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    toast(okMsg || "Copied");
  }
}

document.getElementById("btn-copy-uid").onclick = async () => {
  if (!selectedUid) return;
  await copyText(selectedUid, "UID copied");
};

document.getElementById("btn-copy-username").onclick = async () => {
  const username = selectedUser?.user?.username;
  if (!username) return;
  await copyText(String(username), "Username copied");
};

document.getElementById("btn-detail-refresh").onclick = async () => {
  if (!selectedUid) return;
  await loadUserDetail(selectedUid);
  toast("Detail refreshed");
};

document.getElementById("btn-coins-add").onclick = async () => {
  if (!selectedUid) return;
  const delta = Number(document.getElementById("coinsDelta").value || 0);
  if (!Number.isFinite(delta) || delta === 0) return alert("Enter a delta (e.g. 50 or -50)");
  try {
    setStatus("Adjusting Coins...");
    toast("Adjusting Coins...");
    await adminSend("POST", "/admin/users/" + encodeURIComponent(selectedUid) + "/coins/add", { delta });
    await refreshUsersAndDetail();
    setStatus("OK");
    toast("Coins updated");
  } catch (e) {
    alert(e?.message || String(e));
    setStatus("Error");
  }
};

document.getElementById("btn-coins-set").onclick = async () => {
  if (!selectedUid) return;
  const coins = Number(document.getElementById("coinsSet").value);
  if (!Number.isFinite(coins) || coins < 0) return alert("Enter a valid non-negative number");
  try {
    setStatus("Setting Coins...");
    toast("Setting Coins...");
    await adminSend("POST", "/admin/users/" + encodeURIComponent(selectedUid) + "/coins/set", { coins });
    await refreshUsersAndDetail();
    setStatus("OK");
    toast("Coins set");
  } catch (e) {
    alert(e?.message || String(e));
    setStatus("Error");
  }
};

document.getElementById("btn-coins-reset").onclick = async () => {
  if (!selectedUid) return;
  if (!confirm("Reset this user's Coins to 0?")) return;
  try {
    setStatus("Resetting Coins...");
    toast("Resetting Coins...");
    await adminSend("POST", "/admin/users/" + encodeURIComponent(selectedUid) + "/coins/reset", {});
    await refreshUsersAndDetail();
    setStatus("OK");
    toast("Coins reset");
  } catch (e) {
    alert(e?.message || String(e));
    setStatus("Error");
  }
};

document.getElementById("btn-reset-free").onclick = async () => {
  if (!selectedUid) return;
  if (!confirm("Reset free skips/hints used counters to 0?")) return;
  try {
    setStatus("Resetting free counters…");
    toast("Resetting free counters…");
    await adminSend("POST", "/admin/users/" + encodeURIComponent(selectedUid) + "/reset-free", {});
    await refreshUsersAndDetail();
    setStatus("OK");
    toast("Free counters reset");
  } catch (e) {
    alert(e?.message || String(e));
    setStatus("Error");
  }
};

document.getElementById("btn-mark-test-user").onclick = async () => {
  if (!selectedUid) return;
  try {
    setStatus("Marking test user...");
    await adminSend("POST", "/admin/set-test-user", { uid: selectedUid, isTestUser: true });
    await refreshUsersAndDetail();
    updateDetailTestUserControls();
    setStatus("OK");
    toast("Marked as test user");
  } catch (e) {
    alert(e?.message || String(e));
    setStatus("Error");
  }
};

document.getElementById("btn-unmark-test-user").onclick = async () => {
  if (!selectedUid) return;
  if (!confirm("Remove test user flag for this user?")) return;
  try {
    setStatus("Removing test flag...");
    await adminSend("POST", "/admin/set-test-user", { uid: selectedUid, isTestUser: false });
    await refreshUsersAndDetail();
    updateDetailTestUserControls();
    setStatus("OK");
    toast("Test user flag removed");
  } catch (e) {
    alert(e?.message || String(e));
    setStatus("Error");
  }
};

document.getElementById("btn-fraud-recompute").onclick = async () => {
  if (!selectedUid) return;
  try {
    setStatus("Re-evaluating fraud...");
    await adminSend("POST", "/admin/users/" + encodeURIComponent(selectedUid) + "/fraud-recompute", {});
    await refreshUsersAndDetail();
    toast("Fraud score re-evaluated");
    setStatus("OK");
  } catch (e) {
    alert(e?.message || String(e));
    setStatus("Error");
  }
};

document.getElementById("btn-force-manual-review").onclick = async () => {
  if (!selectedUid) return;
  if (!confirm("Force manual review for this user?")) return;
  try {
    await adminSend("POST", "/admin/users/" + encodeURIComponent(selectedUid) + "/manual-review", { enabled: true });
    await refreshUsersAndDetail();
    toast("Manual review enabled");
  } catch (e) {
    alert(e?.message || String(e));
  }
};

document.getElementById("btn-clear-suspicious").onclick = async () => {
  if (!selectedUid) return;
  if (!confirm("Clear suspicious flag for this user?")) return;
  try {
    await adminSend("POST", "/admin/users/" + encodeURIComponent(selectedUid) + "/suspicious-clear", {});
    await refreshUsersAndDetail();
    toast("Suspicious flag cleared");
  } catch (e) {
    alert(e?.message || String(e));
  }
};

document.getElementById("btn-unlock-payout").onclick = async () => {
  if (!selectedUid) return;
  if (!confirm("Unlock payout for this user?")) return;
  try {
    await adminSend("POST", "/admin/users/" + encodeURIComponent(selectedUid) + "/payout-unlock", {});
    await refreshUsersAndDetail();
    toast("Payout unlocked");
  } catch (e) {
    alert(e?.message || String(e));
  }
};
document.getElementById("btn-user-delete").onclick = async () => {
  if (!selectedUid) return;

  const username = selectedUser?.user?.username || selectedUid;
  const ok = confirm(
    `⚠️ DELETE USER\n\n${username}\n\nThis cannot be undone.\n\nContinue?`
  );
  if (!ok) return;

  try {
    setStatus("Deleting user...");
    toast("Deleting user...");

    await fetch(`${API_BASE}/admin/users/${encodeURIComponent(selectedUid)}`, {
      method: "DELETE",
      headers: { "x-admin-secret": ADMIN_SECRET }
    });

    // reset UI
    selectedUid = null;
    selectedUser = null;
    setDetailEnabled(false);
    document.getElementById("userDetail").innerHTML =
      `<div class="muted">User deleted.</div>`;
    setDetailMeta("No user selected");

    await loadUsers(true);

    setStatus("OK");
    toast("User deleted");
  } catch (e) {
    alert(e?.message || String(e));
    setStatus("Error");
  }
};

document.getElementById("btn-user-reset").onclick = async () => {
  if (!selectedUid) return;
  if (!isTestUser(selectedUser?.user)) return alert("Reset is allowed only for test users");

  const username = selectedUser?.user?.username || selectedUid;
  const ok = confirm(
    `Reset this user to a new player state?\n\n${username}\n\nThis resets Coins, Score, progress, and monthly testing state for this user only.`
  );
  if (!ok) return;

  const reason = String(prompt("Reason for reset:", "testing reset") || "").trim();
  if (!reason) return alert("Reason is required");

  try {
    setStatus("Resetting user...");
    toast("Resetting user...");
    await adminSend("POST", "/admin/reset-user", {
      uid: selectedUid,
      reason,
    });
    await refreshUsersAndDetail();
    setStatus("OK");
    toast("User reset");
  } catch (e) {
    alert(e?.message || String(e));
    setStatus("Error");
  }
};

/* NAV / INIT */
document.getElementById("tab-users").onclick = () => { showView("users"); loadUsers(true); };
document.getElementById("tab-online").onclick = () => { showView("online"); loadOnline(); };
document.getElementById("tab-payouts").onclick = () => { showView("payouts"); loadPayouts(); };

document.getElementById("btn-refresh").onclick = () => {
  const active = document.querySelector(".tab.active")?.id || "tab-users";
  if (active === "tab-users") loadUsers(false);
  else if (active === "tab-online") loadOnline();
  else if (active === "tab-payouts") loadPayouts();
};

document.getElementById("btn-secret").onclick = () => {
  try {
    requireSecret(true);
    document.getElementById("btn-refresh").click();
    toast("Secret updated");
  } catch {}
};

document.getElementById("btn-users-search").onclick = () => loadUsers(true);
document.getElementById("btn-users-prev").onclick = () => { usersOffset = Math.max(0, usersOffset - usersLimit); loadUsers(false); };
document.getElementById("btn-users-next").onclick = () => {
  if (lastUsersCount > 0 && usersOffset + usersLimit >= lastUsersCount) return;
  usersOffset = usersOffset + usersLimit;
  loadUsers(false);
};

document.getElementById("usersSearch").addEventListener("keydown", (e) => {
  if (e.key === "Enter") loadUsers(true);
});
document.getElementById("payoutFilterUid")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    payoutJobsOffset = 0;
    loadPayouts();
  }
});

document.getElementById("btn-online-refresh").onclick = () => loadOnline();

document.getElementById("btn-payout-refresh").onclick = () => {
  payoutJobsOffset = 0;
  loadPayouts();
};

document.getElementById("btn-payout-filter-apply").onclick = () => {
  payoutJobsOffset = 0;
  loadPayouts();
};

document.getElementById("btn-payout-jobs-prev").onclick = () => {
  payoutJobsOffset = Math.max(0, payoutJobsOffset - payoutJobsLimit);
  loadPayouts();
};

document.getElementById("btn-payout-jobs-next").onclick = () => {
  if (payoutJobsCount > 0 && payoutJobsOffset + payoutJobsLimit >= payoutJobsCount) return;
  payoutJobsOffset += payoutJobsLimit;
  loadPayouts();
};

document.getElementById("btn-payout-preview").onclick = async () => {
  const month_key = (document.getElementById("payoutMonthKey")?.value || "").trim();
  if (!month_key) return alert("Month key required (YYYY-MM)");
  await payoutAction(
    "Preview Settlement",
    "",
    async () => {
      const out = await adminFetch("/admin/settlement/preview?month_key=" + encodeURIComponent(month_key));
      renderSettlementSummary(out);
      renderTierSummary(out);
      renderSettlementPreview(out);
      setPayoutActionState("Preview loaded", "ok");
    }
  );
};

document.getElementById("btn-payout-status").onclick = async () => {
  const month_key = (document.getElementById("payoutMonthKey")?.value || "").trim();
  if (!month_key) return alert("Month key required (YYYY-MM)");
  await payoutAction(
    "Check Status",
    "",
    async () => {
      const out = await adminFetch("/admin/settlement/status?month_key=" + encodeURIComponent(month_key));
      renderSettlementSummary(out);
      renderTierSummary(out);
      renderSettlementPreview(out);
      setPayoutActionState("Status loaded", "ok");
    }
  );
};

document.getElementById("btn-payout-run").onclick = async () => {
  const month_key = (document.getElementById("payoutMonthKey")?.value || "").trim();
  const conversion_rate_locked = Number(document.getElementById("payoutRate")?.value);
  const min_payout_threshold_pi = Number(document.getElementById("payoutThreshold")?.value || 0);

  if (!month_key) return alert("Month key required (YYYY-MM)");
  if (!Number.isFinite(conversion_rate_locked) || conversion_rate_locked < 0) return alert("Valid settlement setting required");
  if (!Number.isFinite(min_payout_threshold_pi) || min_payout_threshold_pi < 0) return alert("Valid threshold required");

  await payoutAction(
    "Run Settlement",
    `Run settlement for ${month_key}? Score will reset for the settled season, Coins will not.`,
    async () => {
      const out = await adminSend("POST", "/admin/month-close", { month_key, conversion_rate_locked, min_payout_threshold_pi });
      renderSettlementSummary(out);
      renderTierSummary(out);
      renderSettlementPreview(out);
      if (out?.alreadySettled) {
        toast("This month has already been settled");
      }
    }
  );
};

document.getElementById("btn-payout-run-worker").onclick = async () => {
  await payoutAction(
    "Run Worker",
    "Run payout worker now? This will process queued payout jobs.",
    () => adminSend("POST", "/admin/payouts/worker/run", { limit: 50 })
  );
};



document.getElementById("btn-payout-sim-on").onclick = async () => {
  await payoutAction(
    "Enable simulation",
    "Turn PAYOUT_SIMULATE_SUCCESS ON?",
    () => adminSend("POST", "/admin/payouts/config/simulation", { enabled: true })
  );
};

document.getElementById("btn-payout-sim-off").onclick = async () => {
  await payoutAction(
    "Disable simulation",
    "Turn PAYOUT_SIMULATE_SUCCESS OFF?",
    () => adminSend("POST", "/admin/payouts/config/simulation", { enabled: false })
  );
};
document.getElementById("btn-payout-retry-failed").onclick = async () => {
  const month_key = (document.getElementById("payoutFilterMonth")?.value || document.getElementById("payoutMonthKey")?.value || "").trim();

  await payoutAction(
    "Retry failed payouts",
    month_key
      ? `Retry all failed payouts for ${month_key}?`
      : "Retry all failed payouts across all months?",
    () => adminSend("POST", "/admin/payouts/retry", month_key ? { month_key } : {})
  );
};

window.onload = () => {
  const now = new Date();
  const monthKey = now.getUTCFullYear() + "-" + String(now.getUTCMonth() + 1).padStart(2, "0");
  const monthEl = document.getElementById("payoutMonthKey");
  if (monthEl && !monthEl.value) monthEl.value = monthKey;
  const filterMonthEl = document.getElementById("payoutFilterMonth");
  if (filterMonthEl && !filterMonthEl.value) filterMonthEl.value = monthKey;
  const rateEl = document.getElementById("payoutRate");
  if (rateEl && !rateEl.value) rateEl.value = "0.01";
  const thEl = document.getElementById("payoutThreshold");
  if (thEl && !thEl.value) thEl.value = "0.1";

  showView("users");
  loadUsers(true);
  setDetailEnabled(false);
  setDetailMeta("No user selected");
};

/* -----------------------
   ✅ MOBILE SIDEBAR TOGGLE (REPLACED)
----------------------- */
function isSidebarOpen(){
  return document.getElementById("sidebar")?.classList.contains("open");
}
function openSidebar(){
  document.getElementById("sidebar")?.classList.add("open");
  document.getElementById("overlay")?.classList.add("show");
}
function closeSidebar(){
  document.getElementById("sidebar")?.classList.remove("open");
  document.getElementById("overlay")?.classList.remove("show");
}
function toggleSidebar(){
  if (isSidebarOpen()) closeSidebar();
  else openSidebar();
}

document.getElementById("btnMenu")?.addEventListener("click", toggleSidebar);
document.getElementById("overlay")?.addEventListener("click", closeSidebar);

// ✅ close sidebar when clicking anything in sidebar (buttons/links)
document.getElementById("sidebar")?.addEventListener("click", (e) => {
  const t = e.target;
  if (t && (t.matches("button,a") || t.closest("button,a"))) closeSidebar();
});

// close sidebar if screen resized to desktop
window.addEventListener("resize", () => {
  if (window.innerWidth > 980) closeSidebar();
});


