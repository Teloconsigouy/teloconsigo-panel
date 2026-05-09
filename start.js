const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json({ limit: "20mb" }));
app.use(express.static(__dirname));

const ADMIN_USER = {
  username: "admin",
  name: "Administrador",
  role: "admin",
  permissions: ["all"]
};

function filePath(name) {
  return path.join(__dirname, name);
}

function readJSON(name, fallback = null) {
  try {
    if (!fs.existsSync(filePath(name))) return fallback;
    return JSON.parse(fs.readFileSync(filePath(name), "utf8"));
  } catch (err) {
    console.error("Error leyendo", name, err.message);
    return fallback;
  }
}

function writeJSON(name, data) {
  fs.writeFileSync(filePath(name), JSON.stringify(data, null, 2), "utf8");
}

function getAdsData(account) {
  const cuenta = String(account || "tlc").toLowerCase();
  const file = cuenta.includes("top")
    ? "MeLi_Ads_TOP_SHOP.json"
    : "MeLi_Ads_TLC.json";

  return readJSON(file, {
    campaigns: [],
    campanas: [],
    anuncios: [],
    ads: []
  });
}

function getInboxData(account) {
  const cuenta = String(account || "all").toLowerCase();

  const tlc = readJSON("MeLi_Inbox_TLC.json", {});
  const top = readJSON("MeLi_Inbox_TOP_SHOP.json", {});

  if (cuenta.includes("top")) return { cuenta: "topshop", ...top };
  if (cuenta.includes("tlc")) return { cuenta: "tlc", ...tlc };

  return {
    tlc,
    topshop: top
  };
}

app.post("/api/login", (req, res) => {
  return res.json({
    ok: true,
    success: true,
    user: ADMIN_USER
  });
});

app.get("/api/me", (req, res) => {
  return res.json({
    ok: true,
    user: ADMIN_USER
  });
});

app.post("/api/logout", (req, res) => {
  return res.json({ ok: true });
});

app.get("/api/state", (req, res) => {
  const state = readJSON("inbox-state.json", {
    messages: {},
    questions: {},
    claims: {}
  });

  return res.json({
    ok: true,
    user: ADMIN_USER,
    state
  });
});

app.post("/api/state", (req, res) => {
  const state = req.body || {};
  writeJSON("inbox-state.json", state);

  return res.json({
    ok: true,
    state
  });
});

app.get("/api/meli", (req, res) => {
  const cuenta = req.query.cuenta || req.query.account || "tlc";
  const ads = getAdsData(cuenta);

  return res.json({
    ok: true,
    cuenta,
    ...ads,
    data: ads
  });
});

app.get("/api/meliads", (req, res) => {
  const cuenta = req.query.cuenta || req.query.account || "tlc";
  const ads = getAdsData(cuenta);

  return res.json({
    ok: true,
    cuenta,
    ...ads,
    data: ads
  });
});

app.get("/api/ads", (req, res) => {
  const cuenta = req.query.cuenta || req.query.account || "tlc";
  return res.json(getAdsData(cuenta));
});

app.get("/api/inbox", (req, res) => {
  const cuenta = req.query.cuenta || req.query.account || "all";
  const action = String(req.query.action || req.query.type || "").toLowerCase();

  return res.json({
    ok: true,
    action,
    data: getInboxData(cuenta)
  });
});

app.get("/api/inbox-state", (req, res) => {
  const state = readJSON("inbox-state.json", {
    messages: {},
    questions: {},
    claims: {}
  });

  return res.json({
    ok: true,
    state
  });
});

app.post("/api/inbox-state", (req, res) => {
  const state = req.body || {};
  writeJSON("inbox-state.json", state);

  return res.json({
    ok: true,
    state
  });
});

app.post("/api/inbox-state/update", (req, res) => {
  const current = readJSON("inbox-state.json", {
    messages: {},
    questions: {},
    claims: {}
  });

  const { section, key, patch } = req.body;

  if (!section || !key) {
    return res.status(400).json({
      ok: false,
      message: "Falta section o key"
    });
  }

  if (!current[section]) current[section] = {};
  if (!current[section][key]) current[section][key] = {};

  current[section][key] = {
    ...current[section][key],
    ...patch,
    updatedAt: new Date().toISOString(),
    updatedBy: ADMIN_USER.name
  };

  writeJSON("inbox-state.json", current);

  return res.json({
    ok: true,
    state: current
  });
});

app.post("/api/reply", (req, res) => {
  return res.json({
    ok: true,
    success: true,
    message: "Respuesta registrada"
  });
});

app.post("/api/respond", (req, res) => {
  return res.json({
    ok: true,
    success: true,
    message: "Respuesta registrada"
  });
});

app.post("/api/question/reply", (req, res) => {
  return res.json({
    ok: true,
    success: true,
    message: "Respuesta registrada"
  });
});

app.post("/api/message/reply", (req, res) => {
  return res.json({
    ok: true,
    success: true,
    message: "Respuesta registrada"
  });
});

app.use("/api", (req, res) => {
  return res.status(404).json({
    ok: false,
    message: "API no encontrada",
    path: req.path
  });
});

app.listen(PORT, () => {
  console.log("Servidor iniciado en puerto " + PORT);
});
