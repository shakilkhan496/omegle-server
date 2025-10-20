const express = require("express")
const { createServer } = require("http")
const { Server } = require("socket.io")
const cors = require("cors")

const app = express()
const httpServer = createServer(app)

app.use(cors())
app.options("*", cors())

const log = (...args) => console.log("[signal]", ...args)

log("Starting signaling server")

const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  transports: ["websocket", "polling"],
})

const connectedUsers = new Set()
const waitingUsers = new Set()
const activeConnections = new Map()

const getPartnerId = (socketId) => activeConnections.get(socketId) || null

const detachPartner = (socketId) => {
  if (!activeConnections.has(socketId)) return null
  const partnerId = activeConnections.get(socketId)

  activeConnections.delete(socketId)
  if (partnerId) {
    activeConnections.delete(partnerId)
  }

  return partnerId || null
}

const emitMetrics = () => {
  log(
    `metrics connected=${connectedUsers.size} waiting=${waitingUsers.size} active=${activeConnections.size / 2}`,
  )
}

io.on("connection", (socket) => {
  log("client connected", socket.id)
  connectedUsers.add(socket.id)
  emitMetrics()

  socket.on("ready", () => {
    log("client ready", socket.id)

    const previousPartner = detachPartner(socket.id)
    if (previousPartner) {
      io.to(previousPartner).emit("partnerLeft")
    }

    waitingUsers.delete(socket.id)

    let partnerId = null
    for (const waitingUser of waitingUsers) {
      if (waitingUser !== socket.id && connectedUsers.has(waitingUser)) {
        partnerId = waitingUser
        break
      }
    }

    if (partnerId) {
      waitingUsers.delete(partnerId)
      activeConnections.set(socket.id, partnerId)
      activeConnections.set(partnerId, socket.id)

      log("matched", socket.id, "with", partnerId)

      socket.emit("matched", { peerId: partnerId })
      io.to(partnerId).emit("matched", { peerId: socket.id })

      const greeting = {
        message: "You're connected. Please be respectful and follow community guidelines.",
        timestamp: Date.now(),
      }
      socket.emit("systemMessage", greeting)
      io.to(partnerId).emit("systemMessage", greeting)
    } else {
      waitingUsers.add(socket.id)
      log("queued", socket.id, `queueSize=${waitingUsers.size}`)
    }

    emitMetrics()
  })

  socket.on("signal", ({ to, data } = {}) => {
    if (!to || !data) return
    log("forward signal", socket.id, "->", to)
    io.to(to).emit("signal", { from: socket.id, data })
  })

  socket.on("chatMessage", (payload = {}) => {
    const text = typeof payload.message === "string" ? payload.message.trim() : ""
    if (!text) return

    const partnerId = getPartnerId(socket.id)
    if (!partnerId) {
      socket.emit("systemMessage", {
        message: "Chat is available once you're connected to a partner.",
        timestamp: Date.now(),
      })
      return
    }

    const sanitized = text.slice(0, 2000)
    const message = {
      from: socket.id,
      message: sanitized,
      timestamp: Date.now(),
    }

    io.to(partnerId).emit("chatMessage", message)
    log("chat", socket.id, "->", partnerId)
  })

  socket.on("disconnect", () => {
    log("client disconnected", socket.id)
    connectedUsers.delete(socket.id)
    waitingUsers.delete(socket.id)

    const partnerId = detachPartner(socket.id)
    if (partnerId) {
      io.to(partnerId).emit("partnerLeft")
    }

    emitMetrics()
  })
})

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
  log(`Server listening on port ${PORT}`)
  log(`Health check available at http://localhost:${PORT}/health`)
})

module.exports = app

