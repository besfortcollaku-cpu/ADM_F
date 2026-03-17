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

/* DASHBOARD */
async function loadDashboard() {
  try {
    setStatus("Loading dashboard…");
    const out = await adminFetch("/admin/stats");
    loadCharts();

    const d = out?.data || {};
    document.getElementById("kpiUsers").textContent = d.users_total ?? "–";
    document.getElementById("kpiCoins").textContent = d.coins_total ?? "–";
    document.getElementById("kpiOnline").textContent = d.online_now ?? "–";
    document.getElementById("kpiAdCount").textContent = d.ad50_count ?? "–";
    document.getElementById("kpiDailyCount").textContent = d.daily_login_count ?? "–";
    document.getElementById("kpiLevels").textContent = d.level_complete_count ?? "–";

    document.getElementById("dashboard").innerHTML =
      "<pre class='mono'>" + escapeHtml(JSON.stringify(out, null, 2)) + "</pre>";

    await loadChartsFromStats(out);
    setStatus("OK");
  } catch (e) {
    console.error(e);
    document.getElementById("dashboard").innerHTML =
      "<span class='danger'>Error: " + escapeHtml(e?.message || String(e)) + "</span>";
    setStatus("Error");
  }
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
    "btn-coins-reset",
    "btn-reset-free",
    "btn-detail-refresh",
    "btn-user-delete"
  ];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.disabled = !on;
  });
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
      <td>${num(u.coins)}</td>
      <td>${num(u.free_skips_used)}</td>
      <td>${num(u.free_hints_used)}</td>
      <td>${num(u.fraud_score)}</td>
      <td>${u.vpn_flag ? "YES" : "NO"}</td>
      <td>${u.suspicious ? "YES" : "NO"}</td>
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

  const parts = [];
  parts.push(`<div class="hrow">
    <div>
      <div style="font-weight:800;font-size:18px">${escapeHtml(u.username || "—")}</div>
      <div class="muted mono">${escapeHtml(u.uid || "")}</div>
    </div>
    <div class="spacer"></div>
    <div class="pill">Coins: <b>${num(u.coins)}</b></div>
  </div>`);
  parts.push(`<div class="divider"></div>`);

  parts.push(`<div class="grid" style="grid-template-columns:repeat(2,minmax(160px,1fr));margin:0">
    <div class="card" style="padding:12px">
      <div class="kpi-title">Free skips used</div>
      <div class="kpi-value" style="font-size:22px">${num(u.free_skips_used)}</div>
      <div class="kpi-sub">Lifetime freebies handled server-side</div>
    </div>
    <div class="card" style="padding:12px">
      <div class="kpi-title">Free hints used</div>
      <div class="kpi-value" style="font-size:22px">${num(u.free_hints_used)}</div>
      <div class="kpi-sub">Lifetime freebies handled server-side</div>
    </div>
  </div>`);

  parts.push(`<div class="divider"></div>`);
  parts.push(`<div class="muted">Progress</div>
    <pre class="mono">${escapeHtml(JSON.stringify(p, null, 2))}</pre>
    <div class="muted">Reward stats</div>
    <pre class="mono">${escapeHtml(JSON.stringify(s, null, 2))}</pre>
    <div class="muted">Last session</div>
    <pre class="mono">${escapeHtml(JSON.stringify(ls, null, 2))}</pre>
  `);
  return parts.join("");
}

async function loadUsers(reset=false) {
  try {
    setStatus("Loading users…");
    if (reset) usersOffset = 0;

    const q = document.getElementById("usersSearch").value.trim();
    const order = document.getElementById("usersOrder").value;
    const suspiciousOnly = document.getElementById("usersOnlySuspicious")?.checked ? "1" : "0";

    const url = "/admin/users"
      + "?search=" + encodeURIComponent(q)
      + "&limit=" + encodeURIComponent(usersLimit)
      + "&offset=" + encodeURIComponent(usersOffset)
      + "&order=" + encodeURIComponent(order)
      + "&suspicious=" + encodeURIComponent(suspiciousOnly);

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
      tbody.innerHTML = `<tr><td colspan="9" class="muted">No users found.</td></tr>`;
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
      `<tr><td colspan="9" class="danger">Error: ${escapeHtml(e?.message || String(e))}</td></tr>`;
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
      <td>${num(r.coins)}</td>
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
      `<tr><td colspan="9" class="danger">Error: ${escapeHtml(e?.message || String(e))}</td></tr>`;
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
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
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
    "btn-payout-close",
    "btn-payout-generate",
    "btn-payout-run-worker",
    "btn-payout-refresh",
    "btn-payout-filter-apply",
    "btn-payout-retry-failed",
    "btn-payout-jobs-prev",
    "btn-payout-jobs-next",
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
    tbody.innerHTML = `<tr><td colspan="9" class="muted">No payout cycles yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${escapeHtml(r.month_key || "-")}</td>
      <td>${escapeHtml(String(r.conversion_rate_locked ?? "-"))}</td>
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
    item("total users snapshotted", summary.total_users_snapshotted),
    item("eligible for payout", summary.eligible_count),
    item("below threshold", summary.below_threshold_count),
    item("queued payouts", summary.queued_count),
    item("paid payouts", summary.paid_count),
    item("failed payouts", summary.failed_count),
    item("total payout Pi", summary.total_payout_pi_amount),
  ].join("");
}

function jobActionButtons(r) {
  const id = Number(r.id || 0);
  return `
    <div class="payout-actions">
      <button class="btn3 mini" data-job-requeue="${id}">Requeue</button>
      <button class="btn3 mini" data-job-resolve="${id}">Mark resolved</button>
    </div>
  `;
}

function renderPayoutJobs(rows) {
  const tbody = document.getElementById("payoutJobsTbody");
  if (!tbody) return;
  if (!Array.isArray(rows) || rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="muted">No payout jobs yet.</td></tr>`;
    setPayoutJobsMeta();
    return;
  }

  const html = [];
  for (const r of rows) {
    const isFailed = String(r.status || "") === "failed";
    html.push(`
      <tr>
        <td class="mono">${escapeHtml(String(r.id || "-"))}</td>
        <td class="mono">${escapeHtml(r.uid || "-")}</td>
        <td>${escapeHtml(String(r.payout_pi_amount ?? "0"))}</td>
        <td>${statusBadge(r.status)}</td>
        <td>${txidCell(r.txid)}</td>
        <td>${escapeHtml(String(r.attempts ?? 0))}</td>
        <td>${isFailed ? `<button class="btn3 mini" data-toggle-error="${Number(r.id || 0)}">View error</button>` : "-"}</td>
        <td class="muted">${escapeHtml(formatIso(r.created_at))}</td>
        <td class="muted">${escapeHtml(formatIso(r.updated_at))}</td>
        <td>${jobActionButtons(r)}</td>
      </tr>
    `);

    if (isFailed) {
      html.push(`
        <tr class="payout-row-detail hidden" id="payout-error-row-${Number(r.id || 0)}">
          <td colspan="10">
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

    const [cfg, cycles, summary, jobs] = await Promise.all([
      adminFetch("/admin/payouts/config"),
      adminFetch("/admin/payouts/cycles?limit=12"),
      adminFetch("/admin/payouts/snapshots" + summaryQs),
      adminFetch(jobsPath),
    ]);

    const simulation = !!cfg?.simulation_mode;
    const simEl = document.getElementById("payoutSimulation");
    if (simEl) {
      simEl.textContent = "Simulation: " + (simulation ? "ON" : "OFF");
      simEl.style.borderColor = simulation ? "#2a57b8" : "#5a2330";
      simEl.style.background = simulation ? "#17305f" : "#1a0f12";
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
    payoutJobsCount = Number(jobs?.count || 0);
    renderPayoutJobs(jobs?.rows || []);
    setPayoutJobsMeta();

    payoutLastRefreshAt = new Date();
    const last = document.getElementById("payoutLastRefresh");
    if (last) last.textContent = "Last refresh: " + payoutLastRefreshAt.toLocaleString();

    setPayoutActionState("Ready", "ok");
    setStatus("Payouts loaded");
    setStatusTone("ok");
  } catch (e) {
    setPayoutActionState("Error", "err");
    setStatus("Payouts error");
    setStatusTone("err");
    toast("Payouts load failed: " + (e?.message || String(e)), 3000);
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
    setStatus("Updating coins…");
    toast("Updating coins…");
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
    setStatus("Setting coins…");
    toast("Setting coins…");
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
  if (!confirm("Reset this user's coins to 0?")) return;
  try {
    setStatus("Resetting coins…");
    toast("Resetting coins…");
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

/* NAV / INIT */
document.getElementById("tab-dashboard").onclick = () => { showView("dashboard"); loadDashboard(); };
document.getElementById("tab-users").onclick = () => { showView("users"); loadUsers(true); };
document.getElementById("tab-online").onclick = () => { showView("online"); loadOnline(); };
document.getElementById("tab-payouts").onclick = () => { showView("payouts"); loadPayouts(); };

document.getElementById("btn-refresh").onclick = () => {
  const active = document.querySelector(".tab.active")?.id || "tab-dashboard";
  if (active === "tab-users") loadUsers(false);
  else if (active === "tab-online") loadOnline();
  else if (active === "tab-payouts") loadPayouts();
  else loadDashboard();
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

document.getElementById("btn-payout-close").onclick = async () => {
  const month_key = (document.getElementById("payoutMonthKey")?.value || "").trim();
  const conversion_rate_locked = Number(document.getElementById("payoutRate")?.value);
  const min_payout_threshold_pi = Number(document.getElementById("payoutThreshold")?.value || 0);

  if (!month_key) return alert("Month key required (YYYY-MM)");
  if (!Number.isFinite(conversion_rate_locked) || conversion_rate_locked < 0) return alert("Valid conversion rate required");
  if (!Number.isFinite(min_payout_threshold_pi) || min_payout_threshold_pi < 0) return alert("Valid threshold required");

  await payoutAction(
    "Close Month",
    `Close month ${month_key}? This locks rate and snapshots user monthly payouts.`,
    () => adminSend("POST", "/admin/month-close", { month_key, conversion_rate_locked, min_payout_threshold_pi })
  );
};

document.getElementById("btn-payout-generate").onclick = async () => {
  const month_key = (document.getElementById("payoutMonthKey")?.value || "").trim();
  if (!month_key) return alert("Month key required (YYYY-MM)");

  await payoutAction(
    "Generate Payouts",
    `Generate payout jobs for ${month_key}?`,
    () => adminSend("POST", "/admin/payouts/generate", { month_key })
  );
};

document.getElementById("btn-payout-run-worker").onclick = async () => {
  await payoutAction(
    "Run Worker",
    "Run payout worker now? This will process queued payout jobs.",
    () => adminSend("POST", "/admin/payouts/worker/run", { limit: 50 })
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

  showView("dashboard");
  loadDashboard();
  setDetailEnabled(false);
  setDetailMeta("No user selected");
};

setInterval(() => {
  const active = document.querySelector(".tab.active")?.id || "";
  if (active === "tab-dashboard") loadDashboard();
}, 30000);


/* -----------------------
   CHARTS (Dashboard)
----------------------- */
let _chartCoins = null;
let _chartLogins = null;

function setChartHint(id, msg){
  const el = document.getElementById(id);
  if (el) el.textContent = msg || "";
}

function ensureChartJs(){
  return new Promise((resolve) => {
    if (window.Chart) return resolve(true);
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js";
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
}

/**
 * Expected shapes (any of these work):
 * 1) out.data.charts = { coins_growth:[{date, total}], daily_logins:[{date, count}] }
 * 2) out.data.coins_growth / out.data.daily_logins as arrays above
 * 3) Optional endpoint: GET /admin/charts?days=14 returning { coins_growth:[...], daily_logins:[...] }
 */
async function loadChartsFromStats(statsOut){
  const days = 14;

  const d = statsOut?.data || {};
  let coins = d?.charts?.coins_growth || d?.coins_growth || null;
  let logins = d?.charts?.daily_logins || d?.daily_logins || null;

  if (!coins || !logins){
    try{
      const out = await adminFetch("/admin/charts?days=" + encodeURIComponent(days));
      const cd = out?.data || out;
      coins = coins || cd?.coins_growth || cd?.charts?.coins_growth || null;
      logins = logins || cd?.daily_logins || cd?.charts?.daily_logins || null;
    }catch(e){
      // ignore if endpoint missing
    }
  }

  if (!Array.isArray(coins) || coins.length === 0){
    const total = Number(d?.coins_total ?? 0) || 0;
    coins = Array.from({length: days}, (_,i)=>{
      const dt = new Date();
      dt.setDate(dt.getDate() - (days-1-i));
      return { date: dt.toISOString().slice(0,10), total };
    });
    setChartHint("chartCoinsHint", "No coins history endpoint yet → showing flat line (uses current total).");
  } else {
    setChartHint("chartCoinsHint", "");
  }

  if (!Array.isArray(logins) || logins.length === 0){
    logins = Array.from({length: days}, (_,i)=>{
      const dt = new Date();
      dt.setDate(dt.getDate() - (days-1-i));
      return { date: dt.toISOString().slice(0,10), count: 0 };
    });
    setChartHint("chartLoginsHint", "No daily logins history endpoint yet → showing zeros.");
  } else {
    setChartHint("chartLoginsHint", "");
  }

  const ok = await ensureChartJs();
  if (!ok){
    setChartHint("chartCoinsHint", "Chart.js failed to load (CDN blocked).");
    setChartHint("chartLoginsHint", "Chart.js failed to load (CDN blocked).");
    return;
  }

  const coinsLabels = coins.map(x => String(x.date || x.day || x.t || "").slice(0,10));
  const coinsValues = coins.map(x => Number(x.total ?? x.value ?? x.coins ?? 0) || 0);

  const loginsLabels = logins.map(x => String(x.date || x.day || x.t || "").slice(0,10));
  const loginsValues = logins.map(x => Number(x.count ?? x.value ?? x.logins ?? 0) || 0);

  const c1 = document.getElementById("chartCoins");
  const c2 = document.getElementById("chartLogins");
  if (!c1 || !c2) return;

  try { _chartCoins?.destroy(); } catch {}
  try { _chartLogins?.destroy(); } catch {}

  _chartCoins = new Chart(c1, {
    type: "line",
    data: {
      labels: coinsLabels,
      datasets: [{
        label: "Total Coins",
        data: coinsValues,
        tension: 0.25,
        pointRadius: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { maxRotation: 0, autoSkip: true } },
        y: { beginAtZero: true }
      }
    }
  });

  _chartLogins = new Chart(c2, {
    type: "bar",
    data: {
      labels: loginsLabels,
      datasets: [{
        label: "Daily Logins",
        data: loginsValues
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { maxRotation: 0, autoSkip: true } },
        y: { beginAtZero: true }
      }
    }
  });
}

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

/* =========================
   CHARTS
========================= */

let coinsChart, usersChart;

async function loadCharts() {
  try {
    const coinsRes = await adminFetch("/admin/charts/coins");
    const usersRes = await adminFetch("/admin/charts/active-users");

    renderCoinsChart(coinsRes);
    renderUsersChart(usersRes);
  } catch (e) {
    console.error("Chart error:", e.message);
  }
}

function renderCoinsChart(data) {
  const ctx = document.getElementById("coinsChart");
  if (!ctx) return;

  if (coinsChart) coinsChart.destroy();

  coinsChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: data.map(d => d.day),
      datasets: [{
        label: "Coins",
        data: data.map(d => d.coins),
        tension: 0.35,
        fill: true
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } }
    }
  });
}

function renderUsersChart(data) {
  const ctx = document.getElementById("usersChart");
  if (!ctx) return;

  if (usersChart) usersChart.destroy();

  usersChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: data.map(d => d.day),
      datasets: [{
        label: "Active Users",
        data: data.map(d => d.active_users)
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } }
    }
  });
}
















