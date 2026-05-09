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

const N8N_TLC = "https://teloconsigo.app.n8n.cloud/webhook/meli-ads-live";
const N8N_TOP = "https://teloconsigo.app.n8n.cloud/webhook/meli-ads-topshop";

function filePath(name) {
  return path.join(__dirname, name);
}

function readJSON(name, fallback = null) {
  try {
    if (!fs.existsSync(filePath(name))) return fallback;
    return JSON.parse(fs.readFileSync(filePath(name), "utf8"));
  } catch {
    return fallback;
  }
}

function writeJSON(name, data) {
  fs.writeFileSync(filePath(name), JSON.stringify(data, null, 2), "utf8");
}

function getAccount(req) {
  const raw = String(
    req.query.account ||
    req.query.cuenta ||
    req.query.store ||
    "tlc"
  ).toLowerCase();

  if (raw.includes("top")) return "topshop";
  return "tlc";
}

function getN8nUrl(account) {
  return account === "topshop" ? N8N_TOP : N8N_TLC;
}

function cacheFile(account, action) {
  return account === "topshop"
    ? `meli-ads-cache-topshop-${action}.json`
    : `meli-ads-cache-tlc-${action}.json`;
}

function normalizeCampaigns(data) {
  const campaigns =
    data?.results ||
    data?.campaigns ||
    data?.campanas ||
    data?.data?.results ||
    data?.data?.campaigns ||
    [];

  return {
    ok: true,
    success: true,
    campaigns,
    campanas: campaigns,
    results: campaigns,
    paging: data?.paging || {},
    total: campaigns.length,
    data: campaigns,
    raw: data
  };
}

async function fetchMeliFromN8N(req) {
  const account = getAccount(req);
  const action = req.query.action || "campaigns";
  const dateFrom = req.query.date_from || "";
  const dateTo = req.query.date_to || "";
  const limit = req.query.limit || "50";
  const offset = req.query.offset || "0";

  const url = new URL(getN8nUrl(account));
  url.searchParams.set("action", action);
  url.searchParams.set("limit", limit);
  url.searchParams.set("offset", offset);

  if (dateFrom) url.searchParams.set("date_from", dateFrom);
  if (dateTo) url.searchParams.set("date_to", dateTo);
  if (req.query.campaign_id) url.searchParams.set("campaign_id", req.query.campaign_id);

  const response = await fetch(url.toString());
  const raw = await response.json();

  let normalized;

  if (action === "campaigns" || action === "metrics") {
    normalized = normalizeCampaigns(raw);
  } else {
    const results =
      raw?.results ||
      raw?.items ||
      raw?.data?.results ||
      raw?.data?.items ||
      [];

    normalized = {
      ok: true,
      success: true,
      results,
      items: results,
      data: results,
      raw
    };
  }

  normalized.account = account;
  normalized.action = action;
  normalized.updatedAt = new Date().toISOString();

  writeJSON(cacheFile(account, action), normalized);

  return normalized;
}

function getMeliCache(req) {
  const account = getAccount(req);
  const action = req.query.action || "campaigns";

  return readJSON(cacheFile(account, action), {
    ok: true,
    success: true,
    account,
    action,
    campaigns: [],
    campanas: [],
    results: [],
    data: [],
    total: 0,
    cached: true,
    empty: true
  });
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
    success: true,
    user: ADMIN_USER
  });
});

app.post("/api/logout", (req, res) => {
  return res.json({ ok: true, success: true });
});

app.get("/api/state", (req, res) => {
  const state = readJSON("inbox-state.json", {
    messages: {},
    questions: {},
    claims: {}
  });

  return res.json({
    ok: true,
    success: true,
    online: true,
    apiKey: true,
    user: ADMIN_USER,
    state
  });
});

app.post("/api/state", (req, res) => {
  writeJSON("inbox-state.json", req.body || {});
  return res.json({ ok: true, success: true });
});

app.get("/api/meli", async (req, res) => {
  try {
    const refresh = String(req.query.refresh || "").toLowerCase();

    if (refresh === "1" || refresh === "true" || refresh === "yes") {
      const fresh = await fetchMeliFromN8N(req);
      return res.json(fresh);
    }

    const cached = getMeliCache(req);
    return res.json(cached);
  } catch (err) {
    console.error("Error /api/meli:", err);

    const cached = getMeliCache(req);
    if (!cached.empty) return res.json(cached);

    return res.status(500).json({
      ok: false,
      success: false,
      message: "Error obteniendo datos de MeLi ADS"
    });
  }
});

app.get("/api/meliads", async (req, res) => {
  try {
    const refresh = String(req.query.refresh || "").toLowerCase();

    if (refresh === "1" || refresh === "true" || refresh === "yes") {
      const fresh = await fetchMeliFromN8N(req);
      return res.json(fresh);
    }

    const cached = getMeliCache(req);
    return res.json(cached);
  } catch (err) {
    console.error("Error /api/meliads:", err);

    const cached = getMeliCache(req);
    if (!cached.empty) return res.json(cached);

    return res.status(500).json({
      ok: false,
      success: false,
      message: "Error obteniendo datos de MeLi ADS"
    });
  }
});

app.get("/api/ads", async (req, res) => {
  try {
    const refresh = String(req.query.refresh || "").toLowerCase();

    if (refresh === "1" || refresh === "true" || refresh === "yes") {
      const fresh = await fetchMeliFromN8N(req);
      return res.json(fresh);
    }

    const cached = getMeliCache(req);
    return res.json(cached);
  } catch (err) {
    console.error("Error /api/ads:", err);

    const cached = getMeliCache(req);
    if (!cached.empty) return res.json(cached);

    return res.status(500).json({
      ok: false,
      success: false,
      message: "Error obteniendo datos de MeLi ADS"
    });
  }
});

app.post("/api/meli/refresh", async (req, res) => {
  try {
    req.query = {
      ...req.query,
      ...req.body,
      refresh: "true"
    };

    const fresh = await fetchMeliFromN8N(req);
    return res.json(fresh);
  } catch (err) {
    console.error("Error /api/meli/refresh:", err);
    return res.status(500).json({
      ok: false,
      success: false,
      message: "Error actualizando datos"
    });
  }
});

app.get("/api/inbox", (req, res) => {
  const account = getAccount(req);

  const file =
    account === "topshop"
      ? "MeLi_Inbox_TOP_SHOP.json"
      : "MeLi_Inbox_TLC.json";

  const data = readJSON(file, {});

  return res.json({
    ok: true,
    success: true,
    data,
    ...data
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
    success: true,
    state
  });
});

app.post("/api/inbox-state", (req, res) => {
  writeJSON("inbox-state.json", req.body || {});
  return res.json({ ok: true, success: true });
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
      success: false,
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
    success: true,
    state: current
  });
});

app.post("/api/reply", (req, res) => {
  return res.json({ ok: true, success: true });
});

app.post("/api/respond", (req, res) => {
  return res.json({ ok: true, success: true });
});

app.post("/api/question/reply", (req, res) => {
  return res.json({ ok: true, success: true });
});

app.post("/api/message/reply", (req, res) => {
  return res.json({ ok: true, success: true });
});

app.use("/api", (req, res) => {
  return res.status(404).json({
    ok: false,
    success: false,
    message: "API no encontrada",
    path: req.path
  });
});

app.listen(PORT, () => {
  console.log("Servidor iniciado en puerto " + PORT);
});
