const express = require("express")
const { createServer } = require("http")
const { Server } = require("socket.io")
const cors = require('cors');

const app = express()
const httpServer = createServer(app)
app.use(cors());
app.options('*', cors());

console.log("🚀 Starting signaling server...")

const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  transports: ["websocket", "polling"],
})

// Simple tracking
const connectedUsers = new Set()
const waitingUsers = new Set()
const activeConnections = new Map() // socketId -> partnerId

io.on("connection", (socket) => {
  console.log("🔌 User connected:", socket.id)
  connectedUsers.add(socket.id)

  socket.on("ready", () => {
    console.log("👤 User ready:", socket.id)

    // Remove from any existing connection
    if (activeConnections.has(socket.id)) {
      const partnerId = activeConnections.get(socket.id)
      activeConnections.delete(socket.id)
      activeConnections.delete(partnerId)

      // Notify partner
      io.to(partnerId).emit("partnerLeft")
    }

    // Remove from waiting
    waitingUsers.delete(socket.id)

    // Find someone to match with
    let partner = null
    for (const waitingUser of waitingUsers) {
      if (waitingUser !== socket.id && connectedUsers.has(waitingUser)) {
        partner = waitingUser
        break
      }
    }

    if (partner) {
      // Match found
      waitingUsers.delete(partner)

      // Create connection
      activeConnections.set(socket.id, partner)
      activeConnections.set(partner, socket.id)

      console.log("🤝 Matched:", socket.id, "with", partner)

      // Notify both
      socket.emit("matched", { peerId: partner })
      io.to(partner).emit("matched", { peerId: socket.id })
    } else {
      // Add to waiting
      waitingUsers.add(socket.id)
      console.log("⏳ Added to queue:", socket.id, "Queue size:", waitingUsers.size)
    }

    console.log(
      "📊 Connected:",
      connectedUsers.size,
      "Waiting:",
      waitingUsers.size,
      "Active:",
      activeConnections.size / 2,
    )
  })

  socket.on("signal", ({ to, data }) => {
    console.log("📡 Signal from", socket.id, "to", to)
    io.to(to).emit("signal", { from: socket.id, data })
  })

  socket.on("disconnect", () => {
    console.log("🔌 User disconnected:", socket.id)

    // Remove from all tracking
    connectedUsers.delete(socket.id)
    waitingUsers.delete(socket.id)

    // Handle active connection
    if (activeConnections.has(socket.id)) {
      const partnerId = activeConnections.get(socket.id)
      activeConnections.delete(socket.id)
      activeConnections.delete(partnerId)

      // Notify partner
      io.to(partnerId).emit("partnerLeft")
    }

    console.log(
      "📊 Connected:",
      connectedUsers.size,
      "Waiting:",
      waitingUsers.size,
      "Active:",
      activeConnections.size / 2,
    )
  })
})

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    stats: {
      totalUsers: connectedUsers.size,
      waitingUsers: waitingUsers.size,
      activeChats: activeConnections.size / 2,
    },
    timestamp: new Date().toISOString(),
  })
})

app.get("/", (req, res) => {
  res.json({
    name: "Video Chat Server",
    status: "running",
    totalUsers: connectedUsers.size,
    waiting: waitingUsers.size,
    activeChats: activeConnections.size / 2,
  })
})

const PORT = process.env.PORT || 4000
httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`)
  console.log(`📊 Health: http://localhost:${PORT}/health`)
})
module.exports = app;