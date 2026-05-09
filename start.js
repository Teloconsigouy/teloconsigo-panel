const express = require("express");

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());
app.use(express.static(__dirname));

const ADMIN_USER = {
  username: "admin",
  name: "Administrador",
  role: "admin",
  permissions: ["all"]
};

app.post("/api/login", (req, res) => {
  res.cookie("auth", "admin-session", {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000
  });

  return res.json({
    ok: true,
    success: true,
    user: ADMIN_USER
  });
});

app.get("/api/me", (req, res) => {
  return res.json({
    user: ADMIN_USER
  });
});

app.post("/api/logout", (req, res) => {
  res.clearCookie("auth");
  return res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log("Servidor iniciado en puerto " + PORT);
});
