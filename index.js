const express = require("express")
const { createServer } = require("http")
const { Server } = require("socket.io")

const app = express()
const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
})

// Waiting peer object structure: { socketId: string, timestamp: number }
let waitingPeer = null

// Clean up old waiting peers (older than 30 seconds)
setInterval(() => {
  if (waitingPeer && Date.now() - waitingPeer.timestamp > 30000) {
    console.log("🧹 Cleaning up stale waiting peer:", waitingPeer.socketId)
    waitingPeer = null
  }
}, 10000)

io.on("connection", (socket) => {
  console.log("🔌 Client connected:", socket.id)

  socket.on("ready", () => {
    console.log("👤 User ready:", socket.id)

    if (waitingPeer && waitingPeer.socketId !== socket.id) {
      // Pair them up
      console.log("🤝 Pairing:", socket.id, "with", waitingPeer.socketId)

      socket.emit("match", { peerId: waitingPeer.socketId })
      io.to(waitingPeer.socketId).emit("match", { peerId: socket.id })

      waitingPeer = null
    } else {
      // Add to waiting queue
      waitingPeer = {
        socketId: socket.id,
        timestamp: Date.now(),
      }
      console.log("⏳ Added to waiting queue:", socket.id)
    }
  })

  socket.on("signal", ({ to, data }) => {
    // Forward signaling data between peers
    io.to(to).emit("signal", { from: socket.id, data })
  })

  socket.on("disconnect", () => {
    console.log("🔌 Client disconnected:", socket.id)

    // Remove from waiting queue if present
    if (waitingPeer && waitingPeer.socketId === socket.id) {
      waitingPeer = null
      console.log("🗑️ Removed from waiting queue:", socket.id)
    }
  })
})

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    connections: io.engine.clientsCount,
    waiting: waitingPeer ? 1 : 0,
  })
})

// Basic info endpoint
app.get("/", (req, res) => {
  res.json({
    name: "Omegle Video Chat Signaling Server",
    status: "running",
    connections: io.engine.clientsCount,
    waiting: waitingPeer ? 1 : 0,
  })
})

const PORT = process.env.PORT || 4000
httpServer.listen(PORT, () => {
  console.log(`🚀 Signaling server running on port ${PORT}`)
  console.log(`📊 Health check available at http://localhost:${PORT}/health`)
})
