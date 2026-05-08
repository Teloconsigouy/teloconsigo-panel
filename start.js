const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

function readJSON(file) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, file), "utf8"));
}

app.post("/api/login", (req, res) => {
  try {
    const { username, password } = req.body;

    const users = readJSON("users.json");

    const user = users.find(
      (u) => u.username === username && u.password === password
    );

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Usuario o contraseña incorrectos",
      });
    }

    res.json({
      success: true,
      user: {
        username: user.username,
        role: user.role || "user",
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Error interno",
    });
  }
});

app.listen(PORT, () => {
  console.log("Servidor iniciado en puerto " + PORT);
});
