const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { execFile } = require("child_process");

const app = express();
const PORT = process.env.PORT || 4000;
const MUSIC_DIR = path.join(__dirname, "music");

const isWindows = process.platform === "win32";
const PYTHON = isWindows ? "python" : "python3";

app.use(cors());
app.use(express.json());

// Auth opcional: se a env API_KEY estiver definida, exige o header x-api-key
const API_KEY = process.env.API_KEY || "";
app.use((req, res, next) => {
  if (API_KEY) {
    const k = req.headers["x-api-key"];
    if (k !== API_KEY) {
      return res.status(401).json({ error: "API key invalida" });
    }
  }
  next();
});

if (!fs.existsSync(MUSIC_DIR)) {
  fs.mkdirSync(MUSIC_DIR, { recursive: true });
}

// Executa o yt-dlp via Python (funciona no Windows e no Linux do servidor)
function runYt(args, opts, cb) {
  execFile(PYTHON, ["-m", "yt_dlp", ...args], opts, cb);
}

// Busca musicas no SoundCloud (nao bloqueia IP de datacenter como o YouTube)
app.get("/search", (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) return res.status(400).json({ error: "Parametro 'q' obrigatorio" });

  const args = [
    "scsearch10:" + q,
    "--flat-playlist",
    "--no-warnings",
    "--print",
    "%(webpage_url)s\t%(title)s\t%(duration)s\t%(uploader)s",
  ];

  runYt(args, { encoding: "utf8", timeout: 40000 }, (err, stdout, stderr) => {
    if (err) {
      return res.status(500).json({ error: "Falha na busca: " + (stderr || err.message) });
    }
    const lines = stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    const results = lines.map((line) => {
      const parts = line.split("\t");
      const url = parts[0];
      const slug = url.split("/").filter(Boolean).pop() || "";
      return {
        id: slug.replace(/[^a-zA-Z0-9_-]/g, "") || crypto.randomBytes(6).toString("hex"),
        title: parts[1],
        duration: parts[2] || null,
        channel: parts[3] || null,
        url: url,
      };
    });
    res.json({ results });
  });
});

// Baixa uma musica do SoundCloud por url (o id tambem pode ser passado como url)
app.get("/download", (req, res) => {
  let url = (req.query.url || "").trim();
  if (!url) {
    return res.status(400).json({ error: "Parametro 'url' obrigatorio (url do SoundCloud)" });
  }

  // Um nome de arquivo estavel baseado na url
  const safeId = crypto
    .createHash("sha1")
    .update(url)
    .digest("hex")
    .substring(0, 16);

  const outputTemplate = path.join(MUSIC_DIR, safeId + ".%(ext)s");

  // SoundCloud ja entrega o audio; o yt-dlp baixa direto.
  // Forcamos mp3 quando possivel sem depender de ffmpeg.
  const args = [
    url,
    "-o",
    outputTemplate,
    "--no-playlist",
    "--no-warnings",
    "-f",
    "bestaudio/best",
  ];

  runYt(args, { encoding: "utf8", timeout: 180000 }, (err, stdout, stderr) => {
    // procura qualquer arquivo gerado (mp3, m4a, ...)
    const files = fs.existsSync(MUSIC_DIR)
      ? fs.readdirSync(MUSIC_DIR).filter((f) => f.startsWith(safeId))
      : [];
    if (files.length === 0) {
      return res
        .status(500)
        .json({ error: "Falha no download: " + (stderr || (err && err.message)) });
    }
    // prefere mp3 se existir, senao o primeiro
    const chosen =
      files.find((f) => f.endsWith(".mp3")) ||
      files.find((f) => f.endsWith(".m4a")) ||
      files[0];
    res.download(path.join(MUSIC_DIR, chosen), chosen);
  });
});

// Lista as musicas salvas localmente (CRUD - Read)
app.get("/songs", (req, res) => {
  const files = fs
    .readdirSync(MUSIC_DIR)
    .filter((f) => /\.(mp3|m4a|opus|webm)$/i.test(f))
    .map((f) => {
      const stat = fs.statSync(path.join(MUSIC_DIR, f));
      return {
        id: path.basename(f).replace(/\.[^/.]+$/, ""),
        file: f,
        size: stat.size,
        sizeMb: (stat.size / 1024 / 1024).toFixed(1),
        url: `http://localhost:${PORT}/file/${encodeURIComponent(f)}`,
      };
    });
  res.json({ songs: files });
});

// Serve o arquivo de musica para o player
app.get("/file/:name", (req, res) => {
  const filePath = path.join(MUSIC_DIR, path.basename(req.params.name));
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Arquivo nao encontrado" });
  res.sendFile(filePath);
});

// Remove uma musica (CRUD - Delete)
app.delete("/songs/:id", (req, res) => {
  const id = path.basename(req.params.id);
  const match = fs.existsSync(MUSIC_DIR)
    ? fs.readdirSync(MUSIC_DIR).find((f) => f.startsWith(id))
    : null;
  if (match) {
    fs.unlinkSync(path.join(MUSIC_DIR, match));
    return res.json({ ok: true });
  }
  res.status(404).json({ error: "Musica nao encontrada" });
});

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    name: "MusicPlayer Backend (SoundCloud)",
    endpoints: ["/search", "/download", "/songs", "/file/:name", "DELETE /songs/:id"],
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend MusicPlayer rodando em http://0.0.0.0:${PORT}`);
});
