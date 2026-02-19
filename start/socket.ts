// start/socket.ts
import { Server } from 'socket.io'
import app from '@adonisjs/core/services/app'
import server from '@adonisjs/core/services/server'

interface LiveStream {
  sessionId: string
  broadcasterId: string
  title: string
  startTime: Date
  viewers: Set<string>
}

let io: Server
const liveStreams = new Map<string, LiveStream>()

app.ready(async () => {
  const httpServer = server.getNodeServer()

  if (!httpServer) {
    console.error('❌ HTTP server not available')
    return
  }

  io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
      allowedHeaders: ['ngrok-skip-browser-warning'],
      credentials: false,
    },
    transports: ['polling', 'websocket'],
    allowUpgrades: true,
    path: '/socket.io/',          
    maxHttpBufferSize: 1e8,
  })

  io.on('connection', (socket) => {
    console.log('User connected:', socket.id)

    // ─── START LIVE ───────────────────────────────────────
    socket.on('start-live', ({ sessionId, title }) => {
      if (!sessionId || !title) return socket.emit('error', 'sessionId and title required')

      for (const stream of liveStreams.values()) {
        if (stream.broadcasterId === socket.id) {
          return socket.emit('error', 'You are already broadcasting')
        }
      }

      const stream: LiveStream = {
        sessionId,
        broadcasterId: socket.id,
        title,
        startTime: new Date(),
        viewers: new Set(),
      }

      liveStreams.set(sessionId, stream)
      socket.join(sessionId)
      socket.data.sessionId = sessionId
      socket.data.role = 'broadcaster'

      console.log(`LIVE STARTED: ${sessionId} "${title}" by ${socket.id}`)

      io.emit('live-started', {
        sessionId,
        title,
        broadcasterId: socket.id,
        startTime: stream.startTime.toISOString(),
      })
    })

    // ─── JOIN LIVE ────────────────────────────────────────
    socket.on('join-live', ({ sessionId }) => {
      const stream = liveStreams.get(sessionId)
      if (!stream) return socket.emit('error', 'Stream not found')
      if (socket.id === stream.broadcasterId) return

      socket.join(sessionId)
      stream.viewers.add(socket.id)
      socket.data.sessionId = sessionId
      socket.data.role = 'viewer'

      console.log(`Viewer joined: ${socket.id} → ${sessionId} (${stream.viewers.size} viewers)`)

      // Tell broadcaster a new viewer joined (so broadcaster can send WebRTC offer)
      io.to(stream.broadcasterId).emit('viewer-joined', {
        viewerId: socket.id,
        sessionId,
      })

      io.to(sessionId).emit('viewer-count', {
        sessionId,
        count: stream.viewers.size,
      })
    })

    // ─── STOP LIVE ────────────────────────────────────────
    socket.on('stop-live', ({ sessionId }) => {
      const stream = liveStreams.get(sessionId)
      if (!stream || socket.id !== stream.broadcasterId) return

      io.to(sessionId).emit('live-stopped', {
        sessionId,
        endTime: new Date().toISOString(),
        reason: 'stopped-by-broadcaster',
      })

      liveStreams.delete(sessionId)
      console.log(`LIVE STOPPED: ${sessionId}`)
    })

    // ─── DISCONNECT ───────────────────────────────────────
    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id)

      for (const [sessionId, stream] of liveStreams.entries()) {
        if (stream.broadcasterId === socket.id) {
          io.to(sessionId).emit('live-stopped', {
            sessionId,
            reason: 'broadcaster-disconnected',
            endTime: new Date().toISOString(),
          })
          liveStreams.delete(sessionId)
          console.log(`Stream auto-ended: ${sessionId}`)
        } else if (stream.viewers.delete(socket.id)) {
          // Notify broadcaster that viewer left
          io.to(stream.broadcasterId).emit('viewer-left', {
            viewerId: socket.id,
            sessionId,
          })
          io.to(sessionId).emit('viewer-count', {
            sessionId,
            count: stream.viewers.size,
          })
        }
      }
    })

    // ─── GET ACTIVE STREAMS ───────────────────────────────
    socket.on('get-available-streams', (callback) => {
      if (typeof callback !== 'function') return

      const streams = Array.from(liveStreams.values()).map((s) => ({
        sessionId: s.sessionId,
        broadcasterId: s.broadcasterId,
        title: s.title,
        startTime: s.startTime.toISOString(),
        viewersCount: s.viewers.size,
      }))

      callback(streams)
    })

    // ─── WebRTC Signaling ─────────────────────────────────
    // Broadcaster → Viewer: send offer
    socket.on('webrtc-offer', ({ target, offer, sessionId }) => {
      console.log(`WebRTC offer: ${socket.id} → ${target}`)
      io.to(target).emit('webrtc-offer', {
        from: socket.id,
        offer,
        sessionId,
      })
    })

    // Viewer → Broadcaster: send answer
    socket.on('webrtc-answer', ({ target, answer, sessionId }) => {
      console.log(`WebRTC answer: ${socket.id} → ${target}`)
      io.to(target).emit('webrtc-answer', {
        from: socket.id,
        answer,
        sessionId,
      })
    })

    // ICE Candidate exchange
    socket.on('ice-candidate', ({ target, candidate, sessionId }) => {
      io.to(target).emit('ice-candidate', {
        from: socket.id,
        candidate,
        sessionId,
      })
    })
  })

  console.log('Socket.IO server initialized with WebRTC signaling')
})