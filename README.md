# Planning Poker Backend

Backend para aplicação de Planning Poker utilizando Node.js e Socket.io.

## Funcionalidades

- ✅ Criar salas com UUID e nome
- ✅ Compartilhar link da sala para outros usuários
- ✅ Usuários com UUID e nome
- ✅ Lista de atividades por sala
- ✅ Sistema de votação em tempo real
- ✅ Revelação de resultados
- ✅ Sincronização em tempo real via Socket.io

## Instalação

1. Instale as dependências:
```bash
npm install
```

## Execução

### Modo Desenvolvimento (com nodemon)
```bash
npm run dev
```

### Modo Produção
```bash
npm start
```

O servidor estará rodando em `http://localhost:3000`

## API REST

### Criar Sala
```http
POST /api/rooms
Content-Type: application/json

{
  "name": "Sprint 1",
  "ownerName": "João"
}
```

**Resposta:**
```json
{
  "roomId": "uuid-da-sala",
  "userId": "uuid-do-usuario",
  "roomName": "Sprint 1",
  "shareLink": "http://localhost:3000/room/uuid-da-sala"
}
```

### Obter Informações da Sala
```http
GET /api/rooms/:roomId
```

**Resposta:**
```json
{
  "id": "uuid-da-sala",
  "name": "Sprint 1",
  "users": [
    {
      "id": "uuid-do-usuario",
      "name": "João"
    }
  ],
  "activities": [
    {
      "id": "uuid-da-atividade",
      "title": "Implementar login",
      "description": "Sistema de autenticação",
      "status": "pending",
      "result": null
    }
  ],
  "currentActivityId": null
}
```

## Eventos Socket.io

### Cliente → Servidor

#### `join-room`
Entrar em uma sala
```javascript
socket.emit('join-room', {
  roomId: 'uuid-da-sala',
  userId: 'uuid-do-usuario',
  userName: 'João'
});
```

#### `create-activity`
Criar nova atividade (apenas dono da sala)
```javascript
socket.emit('create-activity', {
  roomId: 'uuid-da-sala',
  userId: 'uuid-do-usuario',
  title: 'Implementar login',
  description: 'Sistema de autenticação'
});
```

#### `start-voting`
Iniciar votação de uma atividade (apenas dono da sala)
```javascript
socket.emit('start-voting', {
  roomId: 'uuid-da-sala',
  userId: 'uuid-do-usuario',
  activityId: 'uuid-da-atividade'
});
```

#### `vote`
Votar em uma atividade
```javascript
socket.emit('vote', {
  roomId: 'uuid-da-sala',
  userId: 'uuid-do-usuario',
  activityId: 'uuid-da-atividade',
  vote: 5  // Número da votação (ex: 1, 2, 3, 5, 8, 13, etc.)
});
```

#### `reveal-results`
Revelar resultados da votação (apenas dono da sala)
```javascript
socket.emit('reveal-results', {
  roomId: 'uuid-da-sala',
  userId: 'uuid-do-usuario',
  activityId: 'uuid-da-atividade'
});
```

#### `remove-activity`
Remover uma atividade (apenas dono da sala)
```javascript
socket.emit('remove-activity', {
  roomId: 'uuid-da-sala',
  userId: 'uuid-do-usuario',
  activityId: 'uuid-da-atividade'
});
```

### Servidor → Cliente

#### `room-state`
Estado atual da sala (enviado ao entrar)
```javascript
socket.on('room-state', (data) => {
  // data.room - informações da sala
  // data.users - lista de usuários
  // data.activities - lista de atividades
  // data.currentActivityId - ID da atividade em votação
});
```

#### `user-joined`
Usuário entrou na sala
```javascript
socket.on('user-joined', (data) => {
  // data.userId
  // data.userName
});
```

#### `user-left`
Usuário saiu da sala
```javascript
socket.on('user-left', (data) => {
  // data.userId
  // data.userName
});
```

#### `activity-created`
Nova atividade criada
```javascript
socket.on('activity-created', (data) => {
  // data.id
  // data.title
  // data.description
  // data.status
});
```

#### `voting-started`
Votação iniciada
```javascript
socket.on('voting-started', (data) => {
  // data.activityId
  // data.activity
});
```

#### `vote-received`
Voto recebido (sem revelar valor)
```javascript
socket.on('vote-received', (data) => {
  // data.activityId
  // data.userId
  // data.userName
  // data.hasVoted
});
```

#### `all-voted`
Todos os usuários votaram
```javascript
socket.on('all-voted', (data) => {
  // data.activityId
});
```

#### `results-revealed`
Resultados revelados
```javascript
socket.on('results-revealed', (data) => {
  // data.activityId
  // data.result - média dos votos
  // data.votes - array com todos os votos
});
```

#### `activity-removed`
Atividade removida
```javascript
socket.on('activity-removed', (data) => {
  // data.activityId
});
```

#### `error`
Erro ocorrido
```javascript
socket.on('error', (data) => {
  // data.message
});
```

## Estrutura de Dados

### Sala (Room)
```javascript
{
  id: string,           // UUID
  name: string,         // Nome da sala
  ownerId: string,      // UUID do dono
  users: Map,           // Map<userId, {id, name, socketId, vote}>
  activities: Array,    // Lista de atividades
  currentActivityId: string | null  // ID da atividade em votação
}
```

### Atividade (Activity)
```javascript
{
  id: string,           // UUID
  title: string,        // Título
  description: string,  // Descrição
  votes: Map,           // Map<userId, vote>
  status: 'pending' | 'voting' | 'completed',
  result: number | null // Média dos votos (quando completada)
}
```

### Usuário (User)
```javascript
{
  id: string,           // UUID
  name: string,         // Nome
  roomId: string,       // UUID da sala
  socketId: string     // ID do socket
}
```

## Notas

- O armazenamento é em memória. Em produção, considere usar um banco de dados (MongoDB, PostgreSQL, etc.)
- As salas são identificadas por UUID
- Apenas o dono da sala pode criar atividades, iniciar votação e revelar resultados
- Os votos são mantidos privados até a revelação dos resultados
- O resultado é calculado como a média aritmética dos votos

## Tecnologias

- Node.js
- Express
- Socket.io
- UUID
- CORS

