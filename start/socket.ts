import { Server } from 'socket.io'
import app from '@adonisjs/core/services/app'
import server from '@adonisjs/core/services/server'

interface ViewerInfo {
  socketId: string
  name: string
}

interface LiveStream {
  sessionId: string
  broadcasterId: string
  broadcasterName: string
  title: string
  startTime: Date
  viewers: Map<string, ViewerInfo>
}

let io: Server
const liveStreams = new Map<string, LiveStream>()

app.ready(async () => {
  const httpServer = server.getNodeServer()
  if (!httpServer) return

  io = new Server(httpServer, {
    cors: {
      origin: true,
      methods: ['GET', 'POST'],
      allowedHeaders: ['ngrok-skip-browser-warning'],
      credentials: true,
    },
    transports: ['polling', 'websocket'],
    allowUpgrades: true,
    path: '/socket.io/',
    maxHttpBufferSize: 1e8,
  })

  io.on('connection', (socket) => {
    console.log('User connected:', socket.id)

    // ─── START LIVE ───────────────────────────────────────
    socket.on('start-live', ({ sessionId, title, broadcasterName }) => {
      if (!sessionId || !title) return socket.emit('error', 'sessionId and title required')

      for (const stream of liveStreams.values()) {
        if (stream.broadcasterId === socket.id) return socket.emit('error', 'Already broadcasting')
      }

      const stream: LiveStream = {
        sessionId,
        broadcasterId:   socket.id,
        broadcasterName: broadcasterName || 'Anonymous',
        title,
        startTime: new Date(),
        viewers:   new Map(),
      }

      liveStreams.set(sessionId, stream)
      socket.join(sessionId)
      socket.data.sessionId = sessionId
      socket.data.role      = 'broadcaster'

      io.emit('live-started', {
        sessionId,
        title,
        broadcasterId:   socket.id,
        broadcasterName: stream.broadcasterName,
        startTime:       stream.startTime.toISOString(),
      })
    })

    // ─── JOIN LIVE ────────────────────────────────────────
    socket.on('join-live', ({ sessionId, viewerName }) => {
      const stream = liveStreams.get(sessionId)
      if (!stream) return socket.emit('error', 'Stream not found')
      if (socket.id === stream.broadcasterId) return

      socket.join(sessionId)

      stream.viewers.set(socket.id, {
        socketId: socket.id,
        name:     viewerName || 'Anonymous',
      })

      socket.data.sessionId = sessionId
      socket.data.role      = 'viewer'

      // Broadcaster ko viewer ka naam bhejo
      io.to(stream.broadcasterId).emit('viewer-joined', {
        viewerId:   socket.id,
        viewerName: viewerName || 'Anonymous',
        sessionId,
      })

      // ✅ Turant updated count sabko bhejo
      io.to(sessionId).emit('viewer-count', {
        sessionId,
        count: stream.viewers.size,
      })

      // Updated viewer list sirf broadcaster ko
      io.to(stream.broadcasterId).emit('viewer-list', {
        viewers: Array.from(stream.viewers.values()).map(v => ({
          id:   v.socketId,
          name: v.name,
        }))
      })
    })

    // ─── LEAVE LIVE ───────────────────────────────────────
    // ✅ NEW — viewer explicitly leave kare
    socket.on('leave-live', ({ sessionId }) => {
      const stream = liveStreams.get(sessionId)
      if (!stream) return

      if (stream.viewers.has(socket.id)) {
        const viewerInfo = stream.viewers.get(socket.id)
        stream.viewers.delete(socket.id)
        socket.leave(sessionId)

        // ✅ Turant count update — sabko
        io.to(sessionId).emit('viewer-count', {
          sessionId,
          count: stream.viewers.size,
        })

        // Broadcaster ko viewer left batao
        io.to(stream.broadcasterId).emit('viewer-left', {
          viewerId:   socket.id,
          viewerName: viewerInfo?.name,
          sessionId,
        })

        // Updated viewer list broadcaster ko
        io.to(stream.broadcasterId).emit('viewer-list', {
          viewers: Array.from(stream.viewers.values()).map(v => ({
            id:   v.socketId,
            name: v.name,
          }))
        })

        console.log(`👋 Viewer left: ${viewerInfo?.name} | Session: ${sessionId} | Remaining: ${stream.viewers.size}`)
      }
    })

    // ─── STOP LIVE ────────────────────────────────────────
    socket.on('stop-live', ({ sessionId }) => {
      const stream = liveStreams.get(sessionId)
      if (!stream || socket.id !== stream.broadcasterId) return

      io.to(sessionId).emit('live-stopped', {
        sessionId,
        endTime: new Date().toISOString(),
        reason:  'stopped-by-broadcaster',
      })

      liveStreams.delete(sessionId)
      console.log(`🔴 Stream stopped: ${sessionId}`)
    })

    // ─── DISCONNECT ───────────────────────────────────────
    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id)

      for (const [sessionId, stream] of liveStreams.entries()) {
        if (stream.broadcasterId === socket.id) {
          io.to(sessionId).emit('live-stopped', {
            sessionId,
            reason:  'broadcaster-disconnected',
            endTime: new Date().toISOString(),
          })
          liveStreams.delete(sessionId)
          console.log(`Stream auto-ended: ${sessionId}`)

        } else if (stream.viewers.has(socket.id)) {
          const viewerInfo = stream.viewers.get(socket.id)
          stream.viewers.delete(socket.id)

          // ✅ Turant count update
          io.to(sessionId).emit('viewer-count', {
            sessionId,
            count: stream.viewers.size,
          })

          io.to(stream.broadcasterId).emit('viewer-left', {
            viewerId:   socket.id,
            viewerName: viewerInfo?.name,
            sessionId,
          })

          io.to(stream.broadcasterId).emit('viewer-list', {
            viewers: Array.from(stream.viewers.values()).map(v => ({
              id:   v.socketId,
              name: v.name,
            }))
          })
        }
      }
    })

    // ─── GET AVAILABLE STREAMS ────────────────────────────
    socket.on('get-available-streams', (callback) => {
      if (typeof callback !== 'function') return
      const streams = Array.from(liveStreams.values()).map((s) => ({
        sessionId:       s.sessionId,
        broadcasterId:   s.broadcasterId,
        broadcasterName: s.broadcasterName,
        title:           s.title,
        startTime:       s.startTime.toISOString(),
        viewersCount:    s.viewers.size,
      }))
      callback(streams)
    })

    // ─── WebRTC Signaling ─────────────────────────────────
    socket.on('webrtc-offer', ({ target, offer, sessionId }) => {
      io.to(target).emit('webrtc-offer', { from: socket.id, offer, sessionId })
    })
    socket.on('webrtc-answer', ({ target, answer, sessionId }) => {
      io.to(target).emit('webrtc-answer', { from: socket.id, answer, sessionId })
    })
    socket.on('ice-candidate', ({ target, candidate, sessionId }) => {
      io.to(target).emit('ice-candidate', { from: socket.id, candidate, sessionId })
    })
  })

  console.log('✅ Socket.IO initialized with viewer tracking')
})