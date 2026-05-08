const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

function readJSON(file) {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, file), "utf8")
  );
}

function verifyPassword(password, salt, hash) {
  const testHash = crypto
    .pbkdf2Sync(password, salt, 100000, 64, "sha512")
    .toString("hex");

  return testHash === hash;
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

    const valid = verifyPassword(
      password,
      user.salt,
      user.hash
    );

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
