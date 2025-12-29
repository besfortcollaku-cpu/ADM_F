
const API = "https://adventuremaze.onrender.com";
const ADMIN_SECRET = prompt("Admin secret");

function headers() {
  return {
    "Content-Type": "application/json",
    "x-admin-secret": ADMIN_SECRET
  };
}

async function preview() {
  const uid = document.getElementById("uid").value;
  const r = await fetch(`${API}/admin/payout/preview?uid=${uid}`, { headers: headers() });
  document.getElementById("out").textContent = await r.text();
}

async function createPayout() {
  const uid = document.getElementById("uid").value;
  const piAmount = document.getElementById("pi").value;
  const r = await fetch(`${API}/admin/payout/create`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ uid, piAmount })
  });
  document.getElementById("out").textContent = await r.text();
}

async function confirmPayout() {
  const uid = document.getElementById("uid").value;
  const r = await fetch(`${API}/admin/payout/confirm`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ uid })
  });
  document.getElementById("out").textContent = await r.text();
}
