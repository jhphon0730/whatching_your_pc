# 회사 PC 모니터링

### 아래 사이트를 참고하였음
https://www.4nb.co.kr/v2/products/jtm.php?dcode=101&gad_source=5&gad_campaignid=22147988311&gclid=EAIaIQobChMIyKS5wo36jgMVWcgWBR22XixcEAEYASAAEgJYZ_D_BwE

### 

* React + Go(Gin) 기반의 화면 감시 애플리케이션 / 사용자는 Agnet, Admin이 있음.
* WebRTC를 기반으로 통신하며, 시그널링 서버는 Go(Gin) + Gorilla WebSocket으로 구현.
* 듀얼모니터를 사용하는 사람을 포함하여 결합모드를 통해 모든 모니터를 볼 수 있도록 구현

## Stack

### Frongend
- **React** (with TypeScript)
- **Vite**
- **TailwindCSS**
- **ShadCN UI**
- **WebRTC** (`getUserMedia`, `RTCPeerConnection`, etc.)
- **WebSocket** (for signaling)

### Backend
- **Go (Gin Web Framework)**
- **Gorilla WebSocket**
- **Map[Room]Client** 기반의 동적 방 관리

### Test
- Agent 최대 30명
- Admin 최대 30명 

<img width="1923" height="2160" alt="image" src="https://github.com/user-attachments/assets/3609a078-9b04-4a70-958e-b409d159d6ad" />
<img width="1923" height="2160" alt="image" src="https://github.com/user-attachments/assets/f895f577-7564-45f6-a140-bf6aa310aacd" />

