# Dockerfile para hospedar o backend em plataformas como Render/Railway/Fly.io
# Imagem base com Node + Python + ffmpeg
FROM node:20-slim

# Instala Python, pip e ffmpeg (necessarios para o yt-dlp converter para MP3)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    curl \
    ffmpeg \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Garante que o pip esteja funcional (curl do get-pip como fallback seguro)
RUN python3 -m pip --version 2>/dev/null || (curl -fsSL https://bootstrap.pypa.io/get-pip.py | python3 -)

WORKDIR /app

# Instala o yt-dlp (driver do YouTube)
RUN python3 -m pip install --no-cache-dir --break-system-packages --upgrade yt-dlp

# Copia e instala dependencias do Node
COPY package*.json ./
RUN npm install --omit=dev

# Copia o codigo
COPY . .

# Cria a pasta de musicas
RUN mkdir -p /app/music

EXPOSE 4000

ENV PORT=4000

CMD ["node", "server.js"]
