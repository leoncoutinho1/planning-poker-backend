const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// Armazenamento em memória (em produção, usar banco de dados)
const rooms = new Map(); // roomId -> { id, name, ownerId, users: Map, activities: [] }
const users = new Map(); // userId -> { id, name, roomId, socketId }

// Estrutura de uma sala:
// {
//   id: string (UUID),
//   name: string,
//   ownerId: string (UUID do criador),
//   users: Map<userId, { id, name, socketId, vote: null|number }>,
//   activities: [
//     {
//       id: string (UUID),
//       title: string,
//       description: string,
//       votes: Map<userId, number>,
//       status: 'pending' | 'voting' | 'completed',
//       result: null | number
//     }
//   ],
//   currentActivityId: string | null
// }

// Criar uma nova sala
app.post('/api/rooms', (req, res) => {
  const { name, ownerName } = req.body;

  if (!name || !ownerName) {
    return res.status(400).json({ error: 'Nome da sala e nome do usuário são obrigatórios' });
  }

  const roomId = uuidv4();
  const ownerId = uuidv4();

  const room = {
    id: roomId,
    name: name,
    ownerId: ownerId,
    users: new Map(),
    activities: [],
    currentActivityId: null
  };

  rooms.set(roomId, room);

  // Criar usuário dono da sala
  const owner = {
    id: ownerId,
    name: ownerName,
    roomId: roomId
  };
  users.set(ownerId, owner);

  res.json({
    roomId: roomId,
    userId: ownerId,
    roomName: name,
    shareLink: `${req.protocol}://${req.get('host')}/room/${roomId}`
  });
});

// Obter informações de uma sala
app.get('/api/rooms/:roomId', (req, res) => {
  const { roomId } = req.params;
  const room = rooms.get(roomId);

  if (!room) {
    return res.status(404).json({ error: 'Sala não encontrada' });
  }

  const roomData = {
    id: room.id,
    name: room.name,
    users: Array.from(room.users.values()).map(u => ({
      id: u.id,
      name: u.name
    })),
    activities: room.activities.map(a => ({
      id: a.id,
      title: a.title,
      description: a.description,
      status: a.status,
      result: a.result
    })),
    currentActivityId: room.currentActivityId
  };

  res.json(roomData);
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('Usuário conectado:', socket.id);

  // Entrar em uma sala
  socket.on('join-room', ({ roomId, userId, userName }) => {
    const room = rooms.get(roomId);

    if (!room) {
      socket.emit('error', { message: 'Sala não encontrada' });
      return;
    }

    // Verificar se o usuário existe
    let user = users.get(userId);
    if (!user) {
      // Criar novo usuário
      user = {
        id: userId,
        name: userName,
        roomId: roomId
      };
      users.set(userId, user);
    }

    // Atualizar socketId do usuário
    user.socketId = socket.id;

    // Adicionar usuário à sala se ainda não estiver
    if (!room.users.has(userId)) {
      room.users.set(userId, {
        id: user.id,
        name: user.name,
        socketId: socket.id,
        vote: null
      });
    } else {
      // Atualizar socketId se usuário já estiver na sala
      room.users.get(userId).socketId = socket.id;
    }

    socket.join(roomId);

    // Notificar outros usuários
    socket.to(roomId).emit('user-joined', {
      userId: user.id,
      userName: user.name
    });

    // Enviar estado atual da sala para o novo usuário
    socket.emit('room-state', {
      room: {
        id: room.id,
        name: room.name,
        ownerId: room.ownerId
      },
      users: Array.from(room.users.values()).map(u => ({
        id: u.id,
        name: u.name
      })),
      activities: room.activities.map(a => ({
        id: a.id,
        title: a.title,
        description: a.description,
        status: a.status,
        result: a.result
      })),
      currentActivityId: room.currentActivityId
    });

    console.log(`Usuário ${userName} (${userId}) entrou na sala ${roomId}`);
  });

  // Criar nova atividade
  socket.on('create-activity', ({ roomId, userId, title, description }) => {
    const room = rooms.get(roomId);

    if (!room) {
      socket.emit('error', { message: 'Sala não encontrada' });
      return;
    }

    const activity = {
      id: uuidv4(),
      title: title || 'Nova Atividade',
      description: description || '',
      votes: new Map(),
      status: 'pending',
      result: null
    };

    room.activities.push(activity);

    io.to(roomId).emit('activity-created', {
      id: activity.id,
      title: activity.title,
      description: activity.description,
      status: activity.status
    });

    console.log(`Atividade criada na sala ${roomId}: ${activity.title}`);
  });

  // Iniciar votação de uma atividade
  socket.on('start-voting', ({ roomId, userId, activityId }) => {
    const room = rooms.get(roomId);

    if (!room) {
      socket.emit('error', { message: 'Sala não encontrada' });
      return;
    }

    const activity = room.activities.find(a => a.id === activityId);
    if (!activity) {
      socket.emit('error', { message: 'Atividade não encontrada' });
      return;
    }

    // Resetar votos anteriores
    activity.votes.clear();
    activity.status = 'voting';
    room.currentActivityId = activityId;

    // Resetar votos dos usuários
    room.users.forEach(user => {
      user.vote = null;
    });

    io.to(roomId).emit('voting-started', {
      activityId: activityId,
      activity: {
        id: activity.id,
        title: activity.title,
        description: activity.description,
        status: activity.status
      }
    });

    console.log(`Votação iniciada para atividade ${activityId} na sala ${roomId}`);
  });

  // Votar em uma atividade
  socket.on('vote', ({ roomId, userId, activityId, vote }) => {
    const room = rooms.get(roomId);

    if (!room) {
      socket.emit('error', { message: 'Sala não encontrada' });
      return;
    }

    if (room.currentActivityId !== activityId) {
      socket.emit('error', { message: 'Esta atividade não está em votação' });
      return;
    }

    const activity = room.activities.find(a => a.id === activityId);
    if (!activity || activity.status !== 'voting') {
      socket.emit('error', { message: 'Atividade não está em votação' });
      return;
    }

    const user = room.users.get(userId);
    if (!user) {
      socket.emit('error', { message: 'Usuário não encontrado na sala' });
      return;
    }

    // Registrar voto
    activity.votes.set(userId, vote);
    user.vote = vote;

    // Notificar todos na sala sobre o voto (sem revelar o valor)
    io.to(roomId).emit('vote-received', {
      activityId: activityId,
      userId: userId,
      userName: user.name,
      hasVoted: true
    });

    // Verificar se todos votaram
    const allUsersVoted = Array.from(room.users.values()).every(u => u.vote !== null);
    if (allUsersVoted) {
      io.to(roomId).emit('all-voted', { activityId: activityId });
    }

    console.log(`Usuário ${user.name} votou ${vote} na atividade ${activityId}`);
  });

  // Revelar resultados
  socket.on('reveal-results', ({ roomId, userId, activityId }) => {
    const room = rooms.get(roomId);

    if (!room) {
      socket.emit('error', { message: 'Sala não encontrada' });
      return;
    }

    const activity = room.activities.find(a => a.id === activityId);
    if (!activity) {
      socket.emit('error', { message: 'Atividade não encontrada' });
      return;
    }

    // Calcular média dos votos
    const votes = Array.from(activity.votes.values());
    const average = votes.length > 0
      ? votes.reduce((sum, vote) => sum + vote, 0) / votes.length
      : 0;

    activity.status = 'completed';
    activity.result = Math.round(average * 10) / 10; // Arredondar para 1 casa decimal
    room.currentActivityId = null;

    // Preparar resultados detalhados
    const results = Array.from(activity.votes.entries()).map(([userId, vote]) => {
      const user = room.users.get(userId);
      return {
        userId: userId,
        userName: user ? user.name : 'Desconhecido',
        vote: vote
      };
    });

    io.to(roomId).emit('results-revealed', {
      activityId: activityId,
      result: activity.result,
      votes: results
    });

    console.log(`Resultados revelados para atividade ${activityId}: ${activity.result}`);
  });

  // Remover atividade
  socket.on('remove-activity', ({ roomId, userId, activityId }) => {
    const room = rooms.get(roomId);

    if (!room) {
      socket.emit('error', { message: 'Sala não encontrada' });
      return;
    }

    const index = room.activities.findIndex(a => a.id === activityId);
    if (index === -1) {
      socket.emit('error', { message: 'Atividade não encontrada' });
      return;
    }

    room.activities.splice(index, 1);

    if (room.currentActivityId === activityId) {
      room.currentActivityId = null;
    }

    io.to(roomId).emit('activity-removed', { activityId: activityId });

    console.log(`Atividade ${activityId} removida da sala ${roomId}`);
  });

  // Desconectar
  socket.on('disconnect', () => {
    console.log('Usuário desconectado:', socket.id);

    // Encontrar e remover usuário das salas
    users.forEach((user, userId) => {
      if (user.socketId === socket.id) {
        const room = rooms.get(user.roomId);
        if (room) {
          room.users.delete(userId);
          socket.to(user.roomId).emit('user-left', {
            userId: userId,
            userName: user.name
          });
        }
        users.delete(userId);
      }
    });
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(`Acesse http://localhost:${PORT}`);
});

