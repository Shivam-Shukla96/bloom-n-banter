import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Server } from 'socket.io';
import multer from 'multer';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const app = express();
const server = createServer(app);

const io = new Server(server);

// Configuration from environment variables
const PORT = process.env.PORT || 8000;
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE) || 10485760; // 10MB default
const UPLOAD_DIR = process.env.UPLOAD_DIR || 'public/uploads/';
const MAX_MESSAGE_HISTORY = parseInt(process.env.MAX_MESSAGE_HISTORY) || 100;

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, UPLOAD_DIR);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: MAX_FILE_SIZE }
});

// Store messages and files in memory
const messageHistory = [];
const connectedUsers = new Map();

app.use(express.static('public'));

const __dirname = dirname(fileURLToPath(import.meta.url));

console.log('dirname -> ', join(__dirname, 'index.html'));

app.get('/', (req, res) => {
    res.sendFile(join(__dirname, 'index.html'));
})

// File upload endpoint
app.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileData = {
        filename: req.file.filename,
        originalName: req.file.originalname,
        path: `/uploads/${req.file.filename}`,
        mimetype: req.file.mimetype,
        size: req.file.size
    };

    res.json(fileData);
});

io.on('connection', (socket) => {

    console.log('a user connected', socket.id);

    // Emit current user count to all clients
    const userCount = io.engine.clientsCount;
    io.emit('user count', userCount);

    // Handle user login with username
    socket.on('user login', (username) => {
        connectedUsers.set(socket.id, username);
        console.log(`${username} logged in with socket id: ${socket.id}`);

        // Send chat history to newly connected user
        socket.emit('chat history', messageHistory);
    });

    socket.on('chat message', (data) => {
        const messageData = {
            type: 'message',
            text: data.text,
            username: data.username,
            socketId: socket.id,
            timestamp: new Date().toISOString()
        };

        // Store message in history
        messageHistory.push(messageData);

        // Limit history to configured max messages
        if (messageHistory.length > MAX_MESSAGE_HISTORY) {
            messageHistory.shift();
        }

        // Broadcast the message to all connected clients
        io.emit('chat message', messageData);
    });

    socket.on('file message', (data) => {
        const fileMessageData = {
            type: 'file',
            fileData: data.fileData,
            username: data.username,
            socketId: socket.id,
            timestamp: new Date().toISOString()
        };

        // Store file message in history
        messageHistory.push(fileMessageData);

        // Limit history to configured max messages
        if (messageHistory.length > MAX_MESSAGE_HISTORY) {
            messageHistory.shift();
        }

        // Broadcast file message to all connected clients
        io.emit('file message', fileMessageData);
    });

    // Handle user logout - delete ALL messages
    socket.on('user logout', (data) => {
        const { username, socketId } = data;
        console.log(`${username} is logging out, clearing entire chat...`);

        // Clear all messages
        const deletedCount = messageHistory.length;
        messageHistory.length = 0;

        console.log(`Deleted all ${deletedCount} messages from chat`);

        // Remove user from connected users
        connectedUsers.delete(socketId);

        // Notify OTHER users (not the one logging out) about the logout
        socket.broadcast.emit('user logged out', { username });

        // Broadcast to all clients that messages were cleared
        io.emit('messages cleared');

        // Send updated chat history to all clients
        io.emit('chat history', messageHistory);
    });

    socket.on('disconnect', () => {
        const username = connectedUsers.get(socket.id);
        console.log(`user disconnected: ${username || socket.id}`);
        connectedUsers.delete(socket.id);

        // Update user count when someone disconnects
        const userCount = io.engine.clientsCount;
        io.emit('user count', userCount);
    });
});


server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
})