const API_BASE = "https://adventuremaze.onrender.com";
let ADMIN_SECRET = sessionStorage.getItem("ADMIN_SECRET");

let usersOffset = 0;
const usersLimit = 25;
let lastUsersCount = 0;
let selectedUid = null;
let selectedUser = null; // cache from /admin/users/:uid response

let onlineTimer = null;

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
    "btn-copy-uid","btn-copy-username","coinsDelta","btn-coins-add","coinsSet","btn-coins-set",
    "btn-coins-reset","btn-reset-free","btn-detail-refresh"
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

    const url = "/admin/users"
      + "?search=" + encodeURIComponent(q)
      + "&limit=" + encodeURIComponent(usersLimit)
      + "&offset=" + encodeURIComponent(usersOffset)
      + "&order=" + encodeURIComponent(order);

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
      tbody.innerHTML = `<tr><td colspan="6" class="muted">No users found.</td></tr>`;
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
      `<tr><td colspan="6" class="danger">Error: ${escapeHtml(e?.message || String(e))}</td></tr>`;
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
      `<tr><td colspan="6" class="danger">Error: ${escapeHtml(e?.message || String(e))}</td></tr>`;
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

/* NAV / INIT */
document.getElementById("tab-dashboard").onclick = () => { showView("dashboard"); loadDashboard(); };
document.getElementById("tab-users").onclick = () => { showView("users"); loadUsers(true); };
document.getElementById("tab-online").onclick = () => { showView("online"); loadOnline(); };

document.getElementById("btn-refresh").onclick = () => {
  const active = document.querySelector(".tab.active")?.id || "tab-dashboard";
  if (active === "tab-users") loadUsers(false);
  else if (active === "tab-online") loadOnline();
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

document.getElementById("btn-online-refresh").onclick = () => loadOnline();

window.onload = () => {
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