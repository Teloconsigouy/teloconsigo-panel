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

function normalizeCampaigns(data) {
  const campaigns =
    data?.results ||
    data?.campaigns ||
    data?.campanas ||
    [];

  return {
    ok: true,
    success: true,
    campaigns: campaigns,
    campanas: campaigns,
    results: campaigns,
    paging: data?.paging || {},
    total: campaigns.length,
    data: campaigns
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
    if (req.query.campaign_id) {
      url.searchParams.set("campaign_id", req.query.campaign_id);
    }

    const response = await fetch(url.toString());
    const data = await response.json();

    if (action === "campaigns" || action === "metrics") {
      return res.json(normalizeCampaigns(data));
    }

    return res.json({
      ok: true,
      success: true,
      data,
      results: data?.results || data?.items || []
    });

  } catch (err) {
    console.error("Error /api/meli:", err);
    return res.status(500).json({
      ok: false,
      success: false,
      message: "Error obteniendo datos de MeLi ADS"
    });
  }
});

app.get("/api/meliads", async (req, res) => {
  try {
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
    if (req.query.campaign_id) {
      url.searchParams.set("campaign_id", req.query.campaign_id);
    }

    const response = await fetch(url.toString());
    const data = await response.json();

    if (action === "campaigns" || action === "metrics") {
      return res.json(normalizeCampaigns(data));
    }

    return res.json({
      ok: true,
      success: true,
      data,
      results: data?.results || data?.items || []
    });

  } catch (err) {
    console.error("Error /api/meliads:", err);
    return res.status(500).json({
      ok: false,
      success: false,
      message: "Error obteniendo datos de MeLi ADS"
    });
  }
});

app.get("/api/ads", async (req, res) => {
  try {
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
    if (req.query.campaign_id) {
      url.searchParams.set("campaign_id", req.query.campaign_id);
    }

    const response = await fetch(url.toString());
    const data = await response.json();

    if (action === "campaigns" || action === "metrics") {
      return res.json(normalizeCampaigns(data));
    }

    return res.json({
      ok: true,
      success: true,
      data,
      results: data?.results || data?.items || []
    });

  } catch (err) {
    console.error("Error /api/ads:", err);
    return res.status(500).json({
      ok: false,
      success: false,
      message: "Error obteniendo datos de MeLi ADS"
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
