package main

import (
	"log"

	"github.com/gin-gonic/gin"
)

var hub = NewHub()

func main() {
	go hub.Run()

	r := gin.Default()

	// production mode
	gin.SetMode(gin.ReleaseMode)

	r.GET("/ws", func(c *gin.Context) {
		ServeWs(hub, c.Writer, c.Request)
	})
	log.Println("✅ WebSocket 서버 시작 :8080")
	r.Run(":8080")
}
