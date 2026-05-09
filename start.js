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

app.get("/api/meliads", (req, res) => {
  const cuenta = String(req.query.cuenta || req.query.account || "tlc").toLowerCase();

  const file =
    cuenta.includes("top")
      ? "MeLi_Ads_TOP_SHOP.json"
      : "MeLi_Ads_TLC.json";

  const data = readJSON(file, { campaigns: [], anuncios: [], ads: [] });

  return res.json({
    ok: true,
    cuenta,
    data
  });
});

app.get("/api/ads", (req, res) => {
  const cuenta = String(req.query.cuenta || req.query.account || "tlc").toLowerCase();

  const file =
    cuenta.includes("top")
      ? "MeLi_Ads_TOP_SHOP.json"
      : "MeLi_Ads_TLC.json";

  const data = readJSON(file, { campaigns: [], anuncios: [], ads: [] });

  return res.json(data);
});

app.get("/api/inbox", (req, res) => {
  const cuenta = String(req.query.cuenta || req.query.account || "all").toLowerCase();
  const action = String(req.query.action || req.query.type || "").toLowerCase();

  const tlc = readJSON("MeLi_Inbox_TLC.json", {});
  const top = readJSON("MeLi_Inbox_TOP_SHOP.json", {});

  let data;

  if (cuenta.includes("top")) {
    data = { cuenta: "topshop", ...top };
  } else if (cuenta.includes("tlc")) {
    data = { cuenta: "tlc", ...tlc };
  } else {
    data = {
      tlc,
      topshop: top
    };
  }

  return res.json({
    ok: true,
    action,
    data
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
