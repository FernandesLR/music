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

// Localiza o diretorio do ffmpeg local (Windows). No Linux o ffmpeg vem via PATH.
function ffmpegDir() {
  if (!isWindows) return null;
  const base = path.join(__dirname, "ffmpeg");
  try {
    const sub = fs.readdirSync(base).find((d) =>
      fs.existsSync(path.join(base, d, "bin", "ffmpeg.exe"))
    );
    if (sub) return path.join(base, sub, "bin");
  } catch (e) {
    /* ignore */
  }
  return null;
}

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

// Busca musicas no YouTube usando a busca integrada do yt-dlp (ytsearch)
app.get("/search", (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) return res.status(400).json({ error: "Parametro 'q' obrigatorio" });

  const args = [
    "ytsearch5:" + q,
    "--flat-playlist",
    "--no-warnings",
    "--print",
    "%(id)s\t%(title)s\t%(duration)s\t%(channel)s",
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
      return {
        id: parts[0],
        title: parts[1],
        duration: parts[2] || null,
        channel: parts[3] || null,
        url: "https://www.youtube.com/watch?v=" + parts[0],
      };
    });
    res.json({ results });
  });
});

// Baixa uma musica (por url ou id) como MP3 e salva em /music
app.get("/download", (req, res) => {
  let url = (req.query.url || "").trim();
  if (!url) {
    const id = (req.query.id || "").trim();
    if (!id) return res.status(400).json({ error: "Parametro 'url' ou 'id' obrigatorio" });
    url = "https://www.youtube.com/watch?v=" + id;
  }

  const idMatch = url.match(/[?&]v=([\w-]{11})/) || url.match(/([\w-]{11})$/);
  const videoId = idMatch ? idMatch[1] : crypto.randomBytes(6).toString("hex");

  const safeId = videoId.replace(/[^a-zA-Z0-9_-]/g, "");
  const outputTemplate = path.join(MUSIC_DIR, safeId + ".%(ext)s");

  const args = [
    url,
    "-x",
    "--audio-format",
    "mp3",
    "-o",
    outputTemplate,
    "--no-playlist",
    "--no-warnings",
  ];

  const ffdir = ffmpegDir();
  const fullArgs = ffdir ? args.concat(["--ffmpeg-location", ffdir]) : args;

  runYt(fullArgs, { encoding: "utf8", timeout: 180000 }, (err, stdout, stderr) => {
    const mp3 = path.join(MUSIC_DIR, safeId + ".mp3");
    if (!fs.existsSync(mp3)) {
      return res
        .status(500)
        .json({ error: "Falha no download: " + (stderr || (err && err.message)) });
    }
    res.download(mp3, safeId + ".mp3");
  });
});

// Lista as musicas salvas localmente (CRUD - Read)
app.get("/songs", (req, res) => {
  const files = fs
    .readdirSync(MUSIC_DIR)
    .filter((f) => f.endsWith(".mp3"))
    .map((f) => {
      const stat = fs.statSync(path.join(MUSIC_DIR, f));
      return {
        id: path.basename(f, ".mp3"),
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
  const filePath = path.join(MUSIC_DIR, id + ".mp3");
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return res.json({ ok: true });
  }
  res.status(404).json({ error: "Musica nao encontrada" });
});

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    name: "MusicPlayer Backend",
    endpoints: ["/search", "/download", "/songs", "/file/:name", "DELETE /songs/:id"],
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend MusicPlayer rodando em http://0.0.0.0:${PORT}`);
  console.log("Use 'python -m pip install --upgrade yt-dlp' se algo falhar.");
});
