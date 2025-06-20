"use client"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Monitor, X } from "lucide-react"
import ScreenShare from "./screen-share"

interface Message {
  room: string
  type: string
  data: any
  sender: string
  target?: string
  instanceId?: string
}

interface RoomViewProps {
  socket: WebSocket | null
  roomId: string
  userId: string
  instanceId: string
  fullUserId: string
  onLeave: () => void
}

export default function RoomView({ socket, roomId, userId, instanceId, fullUserId, onLeave }: RoomViewProps) {
  const [users, setUsers] = useState<string[]>([])
  const [displayUsers, setDisplayUsers] = useState<{ id: string; displayId: string }[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [_, setActiveTab] = useState("screen")
  const [currentSharer, setCurrentSharer] = useState<string | null>(null)
  const processedJoinMessages = useRef(new Set<string>())
  const joinedRef = useRef(false)
  const sharingInfoRequested = useRef(false)

  // Extract the base user ID from a full user ID (with instance ID)
  const getBaseUserId = (fullId: string) => {
    const parts = fullId.split("-")
    if (parts.length > 1) {
      // Remove the last part (instance ID)
      return parts.slice(0, -1).join("-")
    }
    return fullId
  }

  // Get a display-friendly user ID
  const getDisplayUserId = (fullId: string) => {
    const baseId = getBaseUserId(fullId)
    const instances = displayUsers.filter((u) => getBaseUserId(u.id) === baseId)

    if (instances.length <= 1) {
      return baseId
    }

    // If this is the current user, add "You" to the display
    if (getBaseUserId(fullId) === userId) {
      return `${baseId} (You - Window ${instances.findIndex((u) => u.id === fullId) + 1})`
    }

    return `${baseId} (Window ${instances.findIndex((u) => u.id === fullId) + 1})`
  }

  useEffect(() => {
    if (!socket) return

    // Add current user to the list
    setUsers((prev) => {
      if (!prev.includes(fullUserId)) {
        return [...prev, fullUserId]
      }
      return prev
    })

    // Update display users
    setDisplayUsers((prev) => {
      if (!prev.some((u) => u.id === fullUserId)) {
        return [...prev, { id: fullUserId, displayId: getDisplayUserId(fullUserId) }]
      }
      return prev
    })

    // When joining a room, request information about any ongoing screen sharing
    const requestScreenShareInfo = () => {
      if (sharingInfoRequested.current) return

      sharingInfoRequested.current = true
      console.log("Requesting screen share info")

      const message: Message = {
        room: roomId,
        type: "request-screen-info",
        data: {},
        sender: fullUserId,
        instanceId: instanceId,
      }
      socket.send(JSON.stringify(message))
    }

    // Request screen share info after connection is established
    if (!joinedRef.current) {
      joinedRef.current = true
      // Request screen info after a short delay to ensure connection is established
      setTimeout(requestScreenShareInfo, 1000)
    }

    socket.onmessage = (event) => {
      const message: Message = JSON.parse(event.data)
      console.log("Received message:", message)

      // Handle join messages
      if (message.type === "join") {
        // Avoid processing the same join message multiple times
        const joinId = `join-${message.sender}-${Date.now()}`
        if (!processedJoinMessages.current.has(joinId)) {
          processedJoinMessages.current.add(joinId)

          setUsers((prev) => {
            if (!prev.includes(message.sender)) {
              return [...prev, message.sender]
            }
            return prev
          })

          // Update display users
          setDisplayUsers((prev) => {
            if (!prev.some((u) => u.id === message.sender)) {
              return [...prev, { id: message.sender, displayId: getDisplayUserId(message.sender) }]
            }
            return prev
          })

          // If we are currently sharing, send a sharing-info message to the new user
          if (currentSharer === fullUserId) {
            setTimeout(() => {
              if (socket?.readyState === WebSocket.OPEN) {
                console.log("Sending sharing-info to new user:", message.sender)
                const sharingInfoMessage: Message = {
                  room: roomId,
                  type: "sharing-info",
                  data: { isSharing: true },
                  sender: fullUserId,
                  target: message.sender,
                  instanceId: instanceId,
                }
                socket.send(JSON.stringify(sharingInfoMessage))
              }
            }, 2000) // Delay to ensure the new user is ready
          }
        }
      }

      // Handle request-screen-info messages
      else if (message.type === "request-screen-info") {
        // If we are sharing, respond with our sharing status
        if (currentSharer === fullUserId) {
          console.log("Responding to screen info request from:", message.sender)
          setTimeout(() => {
            if (socket?.readyState === WebSocket.OPEN) {
              const sharingInfoMessage: Message = {
                room: roomId,
                type: "sharing-info",
                data: { isSharing: true },
                sender: fullUserId,
                target: message.sender,
                instanceId: instanceId,
              }
              socket.send(JSON.stringify(sharingInfoMessage))
            }
          }, 500)
        }
      }

      // Handle leave messages
      else if (message.type === "leave") {
        setUsers((prev) => prev.filter((user) => user !== message.sender))

        // Update display users
        setDisplayUsers((prev) => prev.filter((u) => u.id !== message.sender))

        // If the user who left was sharing, update sharing state
        if (message.sender === currentSharer) {
          setCurrentSharer(null)
        }
      }

      // Handle screen sharing info messages
      else if (message.type === "sharing-info") {
        // Only process if it's for everyone or specifically for us
        if (!message.target || message.target === fullUserId) {
          console.log("Received sharing info:", message.data.isSharing, "from:", message.sender)
          if (message.data.isSharing) {
            setCurrentSharer(message.sender)
          } else if (currentSharer === message.sender) {
            setCurrentSharer(null)
          }
        }
      }

      // Add message to the list for processing by ScreenShare component
      setMessages((prev) => [...prev, message])
    }

    return () => {
      if (socket) {
        socket.onmessage = null
      }
    }
  }, [socket, userId, roomId, currentSharer, fullUserId, instanceId])

  // Periodically clean up the processed join messages set
  useEffect(() => {
    const interval = setInterval(() => {
      if (processedJoinMessages.current.size > 50) {
        // Keep only the most recent 20 messages
        const messages = Array.from(processedJoinMessages.current)
        processedJoinMessages.current = new Set(messages.slice(messages.length - 20))
      }
    }, 30000)

    return () => clearInterval(interval)
  }, [])

  // Update display names when users list changes
  useEffect(() => {
    setDisplayUsers((prev) => {
      const updated = prev.map((user) => ({
        ...user,
        displayId: getDisplayUserId(user.id),
      }))
      return updated
    })
  }, [users])

  const sendMessage = (type: string, data: any, target?: string) => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      const message: Message = {
        room: roomId,
        type,
        data,
        sender: fullUserId,
        instanceId: instanceId,
      }

      if (target) {
        message.target = target
      }

      socket.send(JSON.stringify(message))
    }
  }

  // Update sharing status
  const handleSharingStatusChange = (isSharing: boolean) => {
    if (isSharing) {
      setCurrentSharer(fullUserId)
    } else if (currentSharer === fullUserId) {
      setCurrentSharer(null)
    }

    // Broadcast sharing status to all users in the room
    sendMessage("sharing-info", { isSharing })
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold">Room: {roomId}</h2>
          <p className="text-sm text-muted-foreground">Your ID: {userId}</p>
          <p className="text-xs text-muted-foreground">Instance: {instanceId}</p>
        </div>
        <Button variant="destructive" size="sm" onClick={onLeave}>
          <X className="h-4 w-4 mr-2" /> Leave Room
        </Button>
      </div>

      <Tabs defaultValue="screen" className="w-full" onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="screen">
            <Monitor className="h-4 w-4 mr-2" /> Screen Sharing
          </TabsTrigger>
        </TabsList>

        <TabsContent value="screen" className="mt-4">
          <ScreenShare
            socket={socket}
            sendMessage={sendMessage}
            messages={messages}
            users={users}
            displayUsers={displayUsers}
            currentSharer={currentSharer}
            fullUserId={fullUserId}
            onSharingStatusChange={handleSharingStatusChange}
          />
        </TabsContent>

      </Tabs>
    </div>
  )
}
