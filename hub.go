package main

import (
	"encoding/json"
	"fmt"
	"log"
	"sync"
)

var (
	mutex = &sync.Mutex{}
)

type Hub struct {
	rooms      map[string]map[*Client]bool
	register   chan *Client
	unregister chan *Client
	broadcast  chan *Message
}

func NewHub() *Hub {
	return &Hub{
		rooms:      make(map[string]map[*Client]bool),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		broadcast:  make(chan *Message),
	}
}

func (h *Hub) SendJoinMessage(room string, client *Client) {
	message := Message{
		Room:   room,
		Type:   "join",
		Data:   nil,
		Sender: client.id,
	}
	fmt.Println("Sending join message to room:", room)
	go func() {
		h.broadcast <- &message
	}()
}

func (h *Hub) SendLeaveMessage(room string, client *Client) {
	message := Message{
		Room:   room,
		Type:   "leave",
		Data:   nil,
		Sender: client.id,
	}
	go func() {
		h.broadcast <- &message
	}()
}

func (h *Hub) Run() {
	for {
		select {
		// join & register
		case client := <-h.register:
			if h.rooms[client.room] == nil {
				mutex.Lock()
				h.rooms[client.room] = make(map[*Client]bool)
				mutex.Unlock()
			}
			mutex.Lock()
			h.rooms[client.room][client] = true
			mutex.Unlock()
			h.SendJoinMessage(client.room, client)

		// leave & unregister
		case client := <-h.unregister:
			if _, ok := h.rooms[client.room][client]; ok {
				h.SendLeaveMessage(client.room, client)
				mutex.Lock()
				delete(h.rooms[client.room], client)
				close(client.send)
				mutex.Unlock()
			}

		case message := <-h.broadcast:
			clients, ok := h.rooms[message.Room]
			if !ok {
				fmt.Printf("Room %s does not exist\n", message.Room)
				continue
			}

			for client := range clients {
				raw, err := json.Marshal(message)
				if err != nil {
					log.Println("marshal error:", err)
					continue
				}

				client.send <- raw
			}
		}
	}
}

type Message struct {
	Room       string      `json:"room"`
	Type       string      `json:"type"`
	Data       interface{} `json:"data"`
	Sender     string      `json:"sender"`
	Target     string      `json:"target,omitempty"`
	InstanceId string      `json:"instanceId,omitempty"`
	CurrentPCInfo string `json:"currentPCInfo"`
}
