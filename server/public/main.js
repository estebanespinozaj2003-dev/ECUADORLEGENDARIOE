// =========================
// Helpers
// =========================
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

function openModal(modal) {
  if (!modal) return;

  modal.style.display = "flex";
  modal.setAttribute("aria-hidden", "false");

  // 🔹 Poner foco dentro del modal
  const focusable = modal.querySelector("input, button");
  if (focusable) focusable.focus();
}

function closeModal(modal) {
  if (!modal) return;

  // 🔹 Quitar foco de elementos internos
  const focused = modal.querySelector(":focus");
  if (focused) focused.blur();

  modal.style.display = "none";
  modal.setAttribute("aria-hidden", "true");
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw data;
  return data;
}

// =========================
// State
// =========================
let currentUser = null;
let pendingPremiumLink = null;
let paypalRendered = false;

// =========================
// Elements
// =========================
const imageModal = $("#imageModal");
const loginModal = $("#loginModal");
const registerModal = $("#registerModal");
const premiumModal = $("#premiumModal");
const supportModal = $("#supportModal");

const modalImg = $("#modalImg");

// Navbar buttons
const supportBtn = $("#supportBtn");
const loginOpenBtn = $("#loginOpenBtn");
const logoutBtn = $("#logoutBtn");

// Login fields
const loginEmail = $("#loginEmail");
const loginPass = $("#loginPass");

// Register fields
const regEmail = $("#regEmail");
const regPass = $("#regPass");

// PayPal
const paypalContainer = $("#paypal-button-container");
const paypalStatus = $("#paypalStatus");

// =========================
// Auth buttons UI
// =========================
function updateAuthButtons() {
  if (!loginOpenBtn || !logoutBtn) return;
  const logged = !!currentUser;
  loginOpenBtn.style.display = logged ? "none" : "inline-flex";
  logoutBtn.style.display = logged ? "inline-flex" : "none";
}

// =========================
// Session
// =========================
async function refreshMe() {
  const data = await api("/api/auth/me");
  currentUser = data.user || null;
  updateAuthButtons();
}

// =========================
// Image modal
// =========================
document.addEventListener("click", (e) => {
  const imgDiv = e.target.closest(".card-img");
  if (!imgDiv) return;
  const src = imgDiv.getAttribute("data-image");
  if (!src) return;

  if (modalImg) modalImg.src = src;
  openModal(imageModal);
});

$("#imageModal .close")?.addEventListener("click", () => closeModal(imageModal));
imageModal?.addEventListener("click", (e) => {
  if (e.target === imageModal) closeModal(imageModal);
});

// =========================
// Support modal
// =========================
supportBtn?.addEventListener("click", () => openModal(supportModal));
$(".close-support")?.addEventListener("click", () => closeModal(supportModal));
$("#closeSupport")?.addEventListener("click", () => closeModal(supportModal));
supportModal?.addEventListener("click", (e) => {
  if (e.target === supportModal) closeModal(supportModal);
});

// =========================
// Benefits toggle
// =========================
const benefitsToggle = $("#benefitsToggle");
const benefitsBody = $("#benefitsBody");

benefitsToggle?.addEventListener("click", () => {
  const expanded = benefitsToggle.getAttribute("aria-expanded") === "true";
  benefitsToggle.setAttribute("aria-expanded", String(!expanded));
  if (benefitsBody) benefitsBody.hidden = expanded;
});

// =========================
// Login/Register modals open/close
// =========================
loginOpenBtn?.addEventListener("click", () => openModal(loginModal));

$(".close-login")?.addEventListener("click", () => closeModal(loginModal));
$("#closeLogin")?.addEventListener("click", () => closeModal(loginModal));
loginModal?.addEventListener("click", (e) => {
  if (e.target === loginModal) closeModal(loginModal);
});

$("#openRegisterBtn")?.addEventListener("click", () => {
  closeModal(loginModal);
  openModal(registerModal);
});

$(".close-register")?.addEventListener("click", () => closeModal(registerModal));
$("#closeRegister")?.addEventListener("click", () => closeModal(registerModal));
registerModal?.addEventListener("click", (e) => {
  if (e.target === registerModal) closeModal(registerModal);
});

// =========================
// Auth actions (email)
// =========================
$("#loginBtn")?.addEventListener("click", async () => {
  const email = (loginEmail?.value || "").trim();
  const password = (loginPass?.value || "").trim();
  if (!email || !password) return alert("Completa email y contraseña.");

  try {
    const data = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
    currentUser = data.user;
    updateAuthButtons();
    closeModal(loginModal);

    if (pendingPremiumLink) await openPremiumFlow(pendingPremiumLink);
  } catch {
    alert("No se pudo iniciar sesión. Verifica tus datos.");
  }
});

$("#registerBtn")?.addEventListener("click", async () => {
  const email = (regEmail?.value || "").trim();
  const password = (regPass?.value || "").trim();
  if (!email || !password) return alert("Completa email y contraseña.");

  try {
    const data = await api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
    currentUser = data.user;
    updateAuthButtons();
    closeModal(registerModal);

    if (pendingPremiumLink) await openPremiumFlow(pendingPremiumLink);
  } catch (e) {
    if (e?.error === "USER_EXISTS") return alert("Ese correo ya está registrado.");
    alert("No se pudo registrar.");
  }
});

logoutBtn?.addEventListener("click", async () => {
  try { await api("/api/auth/logout", { method: "POST", body: "{}" }); } catch {}
  currentUser = null;
  pendingPremiumLink = null;
  paypalRendered = false;
  updateAuthButtons();
  alert("Sesión cerrada.");
});

// =========================
// Premium gating
// =========================
$$(".btn-premium").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const link = btn.getAttribute("data-premium-link");
    if (!link) return;

    pendingPremiumLink = link;

    try { await refreshMe(); } catch { currentUser = null; updateAuthButtons(); }

    if (!currentUser) {
      openModal(loginModal);
      return;
    }

    if (currentUser.isPremium) {
      window.location.href = link;
      return;
    }

    await openPremiumFlow(link);
  });
});

function wirePremiumClose() {
  $(".close-premium")?.addEventListener("click", () => closeModal(premiumModal));
  $("#closePremium")?.addEventListener("click", () => closeModal(premiumModal));
  premiumModal?.addEventListener("click", (e) => {
    if (e.target === premiumModal) closeModal(premiumModal);
  });
}
wirePremiumClose();

async function openPremiumFlow(link) {
  pendingPremiumLink = link;
  openModal(premiumModal);
  await renderPayPalButton();
}

// =========================
// PayPal REAL
// =========================
async function loadPayPalSDK({ paypalClientId, premiumCurrency }) {
  if (window.paypal) return;

  const script = document.createElement("script");
  script.src =
    `https://www.paypal.com/sdk/js` +
    `?client-id=${encodeURIComponent(paypalClientId)}` +
    `&currency=${encodeURIComponent(premiumCurrency || "USD")}` +
    `&intent=capture`;

  await new Promise((resolve, reject) => {
    script.onload = resolve;
    script.onerror = reject;
    document.body.appendChild(script);
  });
}

async function renderPayPalButton() {
  if (!paypalContainer) return;

  paypalContainer.innerHTML = `<p class="tiny-note">Cargando PayPal...</p>`;
  if (paypalStatus) paypalStatus.textContent = "";

  // config desde server
  const cfg = await api("/api/config");

  if (!cfg.paypalClientId) {
    paypalContainer.innerHTML = `<p class="tiny-note">Falta PAYPAL_CLIENT_ID en server/.env</p>`;
    return;
  }

  await loadPayPalSDK(cfg);

  if (paypalRendered) return;
  paypalRendered = true;

  paypalContainer.innerHTML = "";

  window.paypal.Buttons({
    createOrder: async () => {
      if (paypalStatus) paypalStatus.textContent = "Creando orden...";
      const r = await api("/api/paypal/create-order", { method: "POST", body: "{}" });
      return r.id;
    },

    onApprove: async (data) => {
      try {
        if (paypalStatus) paypalStatus.textContent = "Confirmando pago...";
        await api("/api/paypal/capture-order", {
          method: "POST",
          body: JSON.stringify({ orderID: data.orderID })
        });

        await refreshMe();

        if (paypalStatus) paypalStatus.textContent = "✅ Pago confirmado. Premium activado.";
        closeModal(premiumModal);

        if (pendingPremiumLink) window.location.href = pendingPremiumLink;
      } catch (e) {
        console.error(e);
        if (paypalStatus) paypalStatus.textContent = "❌ No se pudo confirmar el pago.";
        alert("No se pudo confirmar el pago. Revisa consola (F12).");
      }
    },

    onError: (err) => {
      console.error(err);
      if (paypalStatus) paypalStatus.textContent = "❌ Error PayPal.";
      alert("Error en PayPal. Revisa consola (F12).");
    }
  }).render("#paypal-button-container");
}

// =========================
// Init
// =========================
(async function init() {
  try { await refreshMe(); }
  catch { currentUser = null; updateAuthButtons(); }
})();
