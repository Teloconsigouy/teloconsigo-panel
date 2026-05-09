const express = require("express");

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());
app.use(express.static(__dirname));

app.post("/api/login", (req, res) => {
  return res.json({
    success: true,
    user: {
      username: "admin",
      name: "Administrador",
      role: "admin"
    }
  });
});

app.listen(PORT, () => {
  console.log("Servidor iniciado en puerto " + PORT);
});
