const API_BASE = "https://adventuremaze.onrender.com";
let ADMIN_SECRET = sessionStorage.getItem("ADMIN_SECRET");

let usersOffset = 0;
const usersLimit = 25;
let lastUsersCount = 0;
let selectedUid = null;

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.style.display = "block";
  clearTimeout(t._t);
  t._t = setTimeout(() => t.style.display = "none", 2000);
}

function requireSecret() {
  if (!ADMIN_SECRET) {
    ADMIN_SECRET = prompt("Admin secret:");
    sessionStorage.setItem("ADMIN_SECRET", ADMIN_SECRET);
  }
}

async function adminFetch(path) {
  requireSecret();
  const r = await fetch(API_BASE + path, {
    headers: { "x-admin-secret": ADMIN_SECRET }
  });
  if (!r.ok) throw new Error("Admin error");
  return r.json();
}

/* USERS */
async function loadUsers(reset = false) {
  if (reset) usersOffset = 0;

  const q = document.getElementById("usersSearch").value.trim();
  const out = await adminFetch(
    `/admin/users?search=${encodeURIComponent(q)}&limit=${usersLimit}&offset=${usersOffset}`
  );

  lastUsersCount = out.count;
  const tbody = document.getElementById("usersTbody");

  if (!out.rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="muted">No users found</td></tr>`;
    return;
  }

  tbody.innerHTML = out.rows.map(u => `
    <tr data-uid="${u.uid}">
      <td>${u.username}</td>
      <td class="uid">${u.uid}</td>
      <td>${u.coins}</td>
      <td>${u.free_skips_used}</td>
      <td>${u.free_hints_used}</td>
      <td>${(u.updated_at||"").replace("T"," ").replace("Z","")}</td>
    </tr>
  `).join("");

  tbody.querySelectorAll("tr").forEach(tr => {
    tr.onclick = () => {
      tbody.querySelectorAll("tr").forEach(x => x.classList.remove("selected"));
      tr.classList.add("selected");
      selectedUid = tr.dataset.uid;
      toast("Selected " + selectedUid);
    };
  });
}

/* NAV */
function showView(v) {
  document.querySelectorAll("section").forEach(s => s.classList.add("hidden"));
  document.getElementById("view-" + v).classList.remove("hidden");
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  document.getElementById("tab-" + v).classList.add("active");
}

document.getElementById("tab-dashboard").onclick = () => showView("dashboard");
document.getElementById("tab-users").onclick = () => {
  showView("users");
  loadUsers(true);
};
document.getElementById("tab-online").onclick = () => showView("online");

document.getElementById("btn-users-search").onclick = () => loadUsers(true);
document.getElementById("btn-users-prev").onclick = () => {
  usersOffset = Math.max(0, usersOffset - usersLimit);
  loadUsers();
};
document.getElementById("btn-users-next").onclick = () => {
  if (usersOffset + usersLimit < lastUsersCount) {
    usersOffset += usersLimit;
    loadUsers();
  }
};

/* MOBILE */
const sidebar = document.getElementById("sidebar");
const overlay = document.getElementById("overlay");
document.getElementById("btnMenu").onclick = () => {
  sidebar.classList.toggle("open");
  overlay.classList.toggle("show");
};
overlay.onclick = () => {
  sidebar.classList.remove("open");
  overlay.classList.remove("show");
};

showView("dashboard");