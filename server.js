// server.js
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const cors = require('cors');
const path = require('path');
//const compileWithJDoodle = require('./compilerAPI'); // your compile integration
require('dotenv').config();

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// In-memory store for files per room
// Structure: { [roomId]: { filename: { language, code } } }
const roomFiles = {};

// Compile endpoint (unchanged; expects code & language in body)
app.post('/compile', async (req, res) => {
  const { code, language, versionIndex, stdin } = req.body;
  if (!code || !language) return res.status(400).send("Missing 'code' or 'language'");

  try {
    const output = await compileWithJDoodle(code, language, versionIndex || "0", stdin || "");
    res.json({ output });
  } catch (err) {
    console.error("Compilation Error:", err);
    res.status(500).json({ error: err.toString() });
  }
});

io.on('connection', (socket) => {
  console.log('🟢 New client connected');

  socket.on('join', ({ roomId, username }) => {
    const room = io.sockets.adapter.rooms.get(roomId);
    const count = room ? room.size : 0;

    if (count >= 20) {
      socket.emit('room-full', { roomId, message: 'Room is full (20 users max)' });
      return;
    }

    socket.join(roomId);
    socket.username = username;
    socket.roomId = roomId;
    console.log(`👤 ${username} joined room: ${roomId}`);

    // Ensure room has at least default files on first join
    if (!roomFiles[roomId]) {
      roomFiles[roomId] = {
        'index.html': {
          language: 'html',
          code: '<!-- index.html -->\n<h1>Hello world</h1>'
        },
        'style.css': { language: 'css', code: '/* style.css */\nbody { font-family: sans-serif; }' },
        'script.js': { language: 'javascript', code: '// script.js\nconsole.log("hello");' }
      };
    }

    updateClientsList(roomId);
    // send file list to the newly joined client
    socket.emit('file-list', { files: roomFiles[roomId] });
  });

  // Create a new file in the room
  socket.on('create-file', ({ roomId, filename, language }) => {
    if (!roomFiles[roomId]) roomFiles[roomId] = {};
    if (roomFiles[roomId][filename]) {
      socket.emit('file-exists', { filename });
      return;
    }
    roomFiles[roomId][filename] = { language: language || detectLanguageFromName(filename), code: '' };
    io.to(roomId).emit('file-list', { files: roomFiles[roomId] });
  });

  // Request current room file list
  socket.on('get-files', (roomId) => {
    socket.emit('file-list', { files: roomFiles[roomId] || {} });
  });

  // Scoped code changes by filename
  socket.on('code-change', ({ roomId, filename, code }) => {
    if (roomFiles[roomId] && roomFiles[roomId][filename]) {
      roomFiles[roomId][filename].code = code;
    }
    socket.to(roomId).emit('code-change', { filename, code });
  });

  // Optional: update file content from client (explicit save to server)
  socket.on('save-file-server', ({ roomId, filename, code }) => {
    if (!roomFiles[roomId]) roomFiles[roomId] = {};
    roomFiles[roomId][filename] = roomFiles[roomId][filename] || { language: detectLanguageFromName(filename), code: '' };
    roomFiles[roomId][filename].code = code;
    socket.emit('file-saved', { filename });
  });

  // Delete file (broadcasted)
  socket.on('delete-file', ({ roomId, filename }) => {
    if (roomFiles[roomId] && roomFiles[roomId][filename]) {
      delete roomFiles[roomId][filename];
      io.to(roomId).emit('file-list', { files: roomFiles[roomId] });
    }
  });

  socket.on('chat-message', ({ roomId, username, message }) => {
    io.to(roomId).emit('chat-message', { username, message });
  });

  socket.on('presence', ({ roomId, username, position }) => {
    socket.to(roomId).emit('presence', { username, position });
  });

  socket.on('leave', ({ roomId, username }) => {
    socket.leave(roomId);
    updateClientsList(roomId);
  });

  socket.on('disconnect', () => {
    if (socket.roomId) {
      socket.leave(socket.roomId);
      updateClientsList(socket.roomId);
    }
  });

  function updateClientsList(roomId) {
    const room = io.sockets.adapter.rooms.get(roomId);
    const clients = room ? Array.from(room).map(id => io.sockets.sockets.get(id)?.username || 'Unknown') : [];
    io.to(roomId).emit('joined', { clients });
    io.to(roomId).emit('disconnected', { clients });
  }

  // Utility: simple filename-based language detection
  function detectLanguageFromName(name = '') {
    const n = name.toLowerCase();
    if (n.endsWith('.html')) return 'html';
    if (n.endsWith('.css')) return 'css';
    if (n.endsWith('.js')) return 'javascript';
    if (n.endsWith('.py')) return 'python3';
    if (n.endsWith('.java')) return 'java';
    if (n.endsWith('.c') || n.endsWith('.cpp') || n.endsWith('.cc')) return 'cpp';
    return 'plaintext';
  }
});

const PORT = process.env.PORT || 8000;

// 🔽 Changed this part to log a clickable URL
http.listen(PORT, () => {
  const host = 'localhost';
  console.log(`🚀 Server running at http://${host}:${PORT}`);
});
