const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

function readJSON(file) {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, file), "utf8")
  );
}

app.post("/api/login", (req, res) => {
  try {
    const { username, password } = req.body;

    const data = readJSON("users.json");

    const user = data.users.find(
      (u) => u.username === username
    );

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Usuario incorrecto",
      });
    }

    const valid = password === "admin123";

    if (!valid) {
      return res.status(401).json({
        success: false,
        message: "Contraseña incorrecta",
      });
    }

    return res.json({
      success: true,
      user: {
        username: user.username,
        role: user.role,
        name: user.name,
      },
    });
  } catch (err) {
    console.error(err);

    return res.status(500).json({
      success: false,
      message: "Error interno",
    });
  }
});

app.listen(PORT, () => {
  console.log("Servidor iniciado en puerto " + PORT);
});
