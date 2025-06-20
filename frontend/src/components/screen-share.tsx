"use client"

import { Badge } from "@/components/ui/badge"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Monitor, MonitorOff, Eye, Share2 } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"

interface Message {
  room: string
  type: string
  data: any
  sender: string
  target?: string
  instanceId?: string
}

interface DisplayUser {
  id: string
  displayId: string
}

interface ScreenShareProps {
  socket: WebSocket | null
  sendMessage: (type: string, data: any, target?: string) => void
  messages: Message[]
  users: string[]
  displayUsers: DisplayUser[]
  currentSharer: string | null
  fullUserId: string
  onSharingStatusChange: (isSharing: boolean) => void
}

export default function ScreenShare({
  socket,
  sendMessage,
  messages,
  users,
  displayUsers,
  currentSharer,
  fullUserId,
  onSharingStatusChange,
}: ScreenShareProps) {
  const [isSharing, setIsSharing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const [connectionAttempted, setConnectionAttempted] = useState(false)
  const processedMessages = useRef(new Set<string>())
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map())
  const [isConnecting, setIsConnecting] = useState(false)
  const connectionTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Get display name for a user ID
  const getDisplayName = (userId: string) => {
    const user = displayUsers.find((u) => u.id === userId)
    return user ? user.displayId : userId
  }

  // Handle screen sharing
  const startScreenShare = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      })

      mediaStreamRef.current = stream

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream
      }

      setIsSharing(true)
      onSharingStatusChange(true)
      setError(null)

      // Handle track ended event
      stream.getVideoTracks()[0].onended = () => {
        stopScreenShare()
      }

      // Broadcast to all users that we're now sharing
      sendMessage("sharing-info", { isSharing: true })
    } catch (err) {
      console.error("Error starting screen share:", err)
      setError("Failed to start screen sharing. Please make sure you have granted the necessary permissions.")
    }
  }

  const stopScreenShare = () => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current = null
    }

    // Close all peer connections
    peerConnectionsRef.current.forEach((pc, _) => {
      pc.close()
    })
    peerConnectionsRef.current.clear()

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null
    }

    sendMessage("stop-sharing", {})
    setIsSharing(false)
    onSharingStatusChange(false)
  }

  // Create a peer connection for a specific user
  const createPeerConnection = (targetUserId: string) => {
    // Don't create connection to ourselves
    if (targetUserId === fullUserId) return null

    // Check if we already have a connection to this user
    if (peerConnectionsRef.current.has(targetUserId)) {
      return peerConnectionsRef.current.get(targetUserId)
    }

    console.log("Creating peer connection for user:", targetUserId)

    const peerConnection = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    })

    // Store the connection
    peerConnectionsRef.current.set(targetUserId, peerConnection)

    // Add our stream if we're sharing
    if (isSharing && mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => {
        peerConnection.addTrack(track, mediaStreamRef.current!)
      })
    }

    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        sendMessage(
          "ice-candidate",
          {
            candidate: event.candidate,
          },
          targetUserId,
        )
      }
    }

    // Handle connection state changes
    peerConnection.onconnectionstatechange = () => {
      console.log(`Connection to ${targetUserId} state: ${peerConnection.connectionState}`)

      if (peerConnection.connectionState === "failed" || peerConnection.connectionState === "disconnected") {
        console.log(`Connection to ${targetUserId} failed or disconnected, cleaning up`)
        peerConnectionsRef.current.delete(targetUserId)
      }
    }

    // Handle incoming tracks if we're viewing
    peerConnection.ontrack = (event) => {
      console.log("Received track from user:", targetUserId)
      if (remoteVideoRef.current && !isSharing) {
        remoteVideoRef.current.srcObject = event.streams[0]
        setIsConnecting(false)

        if (connectionTimeoutRef.current) {
          clearTimeout(connectionTimeoutRef.current)
          connectionTimeoutRef.current = null
        }
      }
    }

    return peerConnection
  }

  // Connect to an existing screen share
  const connectToScreenShare = async (sharerUserId: string) => {
    if (!socket || connectionAttempted || !sharerUserId || sharerUserId === fullUserId) return

    setConnectionAttempted(true)
    setIsConnecting(true)

    // Set a timeout to show an error if connection takes too long
    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current)
    }

    connectionTimeoutRef.current = setTimeout(() => {
      if (isConnecting) {
        console.log("Connection timeout, retrying...")
        setConnectionAttempted(false)
        connectToScreenShare(sharerUserId)
      }
    }, 10000)

    console.log("Attempting to connect to screen share from:", sharerUserId)

    // Create a peer connection for the sharer if it doesn't exist
    createPeerConnection(sharerUserId)

    // Request an offer from the sharer
    sendMessage("request-offer", {}, sharerUserId)
  }

  // Generate a unique ID for a message to avoid processing duplicates
  const getMessageId = (message: Message) => {
    return `${message.type}-${message.sender}-${message.instanceId || ""}-${JSON.stringify(message.data).slice(0, 50)}`
  }

  // Handle incoming WebRTC messages
  useEffect(() => {
    if (!socket) return

    const handleWebRTCMessage = async (message: Message) => {
      // Skip if we've already processed this message
      const messageId = getMessageId(message)
      if (processedMessages.current.has(messageId)) {
        return
      }

      // Add to processed messages
      processedMessages.current.add(messageId)

      // If message has a target, make sure it's for us
      if (message.target && message.target !== fullUserId) {
        return
      }

      try {
        // Handle request for offer (when someone wants to view our screen)
        if (message.type === "request-offer" && isSharing && message.sender !== fullUserId) {
          console.log("Received request for offer from:", message.sender)

          // Create a peer connection for this user if it doesn't exist
          const pc = createPeerConnection(message.sender)

          if (pc && mediaStreamRef.current) {
            try {
              // Create a new offer for the requester
              const offer = await pc.createOffer()
              await pc.setLocalDescription(offer)

              sendMessage(
                "offer",
                {
                  sdp: pc.localDescription,
                },
                message.sender,
              )
            } catch (err) {
              console.warn("Error creating offer:", err)
            }
          }
        }

        // Handle offer from another user
        else if (message.type === "offer" && message.sender !== fullUserId) {
          console.log("Received offer from:", message.sender)

          // Create or get peer connection for this user
          const pc = createPeerConnection(message.sender)

          if (pc) {
            try {
              // Set remote description (the offer)
              await pc.setRemoteDescription(new RTCSessionDescription(message.data.sdp))

              // Create answer
              const answer = await pc.createAnswer()
              await pc.setLocalDescription(answer)

              // Send answer back
              sendMessage(
                "answer",
                {
                  sdp: pc.localDescription,
                },
                message.sender,
              )
            } catch (err) {
              console.warn("Error during offer handling:", err)
            }
          }
        }

        // Handle answer to our offer
        else if (message.type === "answer" && message.sender !== fullUserId) {
          console.log("Received answer from:", message.sender)

          const pc = peerConnectionsRef.current.get(message.sender)

          if (pc) {
            try {
              await pc.setRemoteDescription(new RTCSessionDescription(message.data.sdp))
            } catch (err) {
              console.warn("Error setting remote description:", err)
            }
          }
        }

        // Handle ICE candidates
        else if (message.type === "ice-candidate" && message.sender !== fullUserId) {
          const pc = peerConnectionsRef.current.get(message.sender)

          if (pc && message.data.candidate) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(message.data.candidate))
            } catch (err) {
              console.warn("Error adding ICE candidate:", err)
            }
          }
        }

        // Handle stop sharing
        else if (message.type === "stop-sharing" && message.sender === currentSharer) {
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = null
          }
          setConnectionAttempted(false)
          setIsConnecting(false)

          // Close and remove the peer connection to the sharer
          const pc = peerConnectionsRef.current.get(message.sender)
          if (pc) {
            pc.close()
            peerConnectionsRef.current.delete(message.sender)
          }

          if (connectionTimeoutRef.current) {
            clearTimeout(connectionTimeoutRef.current)
            connectionTimeoutRef.current = null
          }
        }
      } catch (err) {
        console.error("Error handling WebRTC message:", err)
      }
    }

    // Process new WebRTC related messages
    const newMessages = messages.filter((message) => {
      const messageId = getMessageId(message)
      return (
        !processedMessages.current.has(messageId) &&
        ["offer", "answer", "ice-candidate", "stop-sharing", "request-offer"].includes(message.type)
      )
    })

    newMessages.forEach(handleWebRTCMessage)
  }, [messages, socket, isSharing, sendMessage, currentSharer, fullUserId])

  // Connect to screen share when currentSharer changes
  useEffect(() => {
    if (currentSharer && currentSharer !== fullUserId && !isSharing && !connectionAttempted) {
      connectToScreenShare(currentSharer)
    }

    // Reset connection attempted if sharer changes or stops
    if (!currentSharer) {
      setConnectionAttempted(false)
      setIsConnecting(false)

      // Clear remote video if we were viewing
      if (remoteVideoRef.current && remoteVideoRef.current.srcObject) {
        remoteVideoRef.current.srcObject = null
      }

      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current)
        connectionTimeoutRef.current = null
      }
    }
  }, [currentSharer, fullUserId, isSharing, connectionAttempted])

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop())
      }

      // Close all peer connections
      peerConnectionsRef.current.forEach((pc) => {
        pc.close()
      })
      peerConnectionsRef.current.clear()

      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current)
      }
    }
  }, [])

  // Limit the size of processed messages set
  useEffect(() => {
    const interval = setInterval(() => {
      if (processedMessages.current.size > 100) {
        processedMessages.current = new Set(Array.from(processedMessages.current).slice(-50))
      }
    }, 10000)

    return () => clearInterval(interval)
  }, [])

  // Determine if we're viewing someone else's screen
  const isViewing = currentSharer && currentSharer !== fullUserId

  // Get display name for current sharer
  const sharerDisplayName = currentSharer ? getDisplayName(currentSharer) : null

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {isSharing && (
        <div className="bg-red-500 text-white p-4 rounded-md flex items-center justify-between animate-pulse">
          <div className="flex items-center gap-2">
            <Share2 className="h-5 w-5" />
            <span className="font-bold text-lg">화면 공유 중</span>
            <span className="text-sm">- 당신의 화면이 다른 사용자에게 공유되고 있습니다</span>
          </div>
          <Button variant="outline" className="bg-white text-red-500 hover:bg-red-50" onClick={stopScreenShare}>
            <MonitorOff className="h-4 w-4 mr-2" /> 공유 중지
          </Button>
        </div>
      )}

      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium">Screen Sharing</h3>
        {!isSharing && !isViewing ? (
          <Button onClick={startScreenShare}>
            <Monitor className="h-4 w-4 mr-2" /> Share Screen
          </Button>
        ) : isSharing ? (
          <Button variant="destructive" onClick={stopScreenShare}>
            <MonitorOff className="h-4 w-4 mr-2" /> Stop Sharing
          </Button>
        ) : (
          <Badge variant="outline" className="flex items-center gap-1">
            <Eye className="h-3 w-3" /> Viewing {sharerDisplayName}'s screen
          </Badge>
        )}
      </div>

      <Card className={`overflow-hidden ${isSharing ? "border-2 border-red-500" : ""}`}>
        <CardContent className="p-0 aspect-video bg-black/10 flex items-center justify-center relative">
          {isSharing ? (
            <>
              <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-contain" />
              <div className="absolute top-2 right-2 bg-red-500 text-white px-3 py-1 rounded-full text-sm font-medium flex items-center gap-1">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
                </span>
                LIVE
              </div>
            </>
          ) : isViewing ? (
            <>
              <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-contain" />
              {(isConnecting || !remoteVideoRef.current?.srcObject) && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-white mx-auto mb-2"></div>
                    <p>연결 중...</p>
                    <p className="text-sm opacity-75">화면 공유에 연결하는 중입니다</p>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-center p-8 text-muted-foreground">
              <Monitor className="h-12 w-12 mx-auto mb-2 opacity-20" />
              <p>No screen is being shared</p>
              <p className="text-sm">Click "Share Screen" to start sharing your screen</p>
            </div>
          )}
        </CardContent>
      </Card>

      {users.length <= 1 && (
        <Alert>
          <AlertDescription>
            You are the only person in this room. Invite others to join room "
            {socket?.url.split("room=")[1].split("&")[0]}" to share your screen with them.
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}
