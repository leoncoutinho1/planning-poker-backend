require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const { createClient } = require('redis');

const app = express();
const server = http.createServer(app);

// Configurar CORS a partir de variável de ambiente
const corsOrigin = process.env.CORS_ORIGIN || "*";
const corsOptions = {
  origin: corsOrigin === "*" ? "*" : (corsOrigin.includes(',') ? corsOrigin.split(',').map(origin => origin.trim()) : corsOrigin),
  methods: ["GET", "POST"],
  credentials: true
};

const io = new Server(server, {
  cors: corsOptions
});

app.use(cors(corsOptions));
app.use(express.json());

// Configurar Redis
const redisClient = createClient({
  username: process.env.REDIS_USERNAME || 'default',
  password: process.env.REDIS_PASSWORD,
  socket: {
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT || '6379')
  }
});

redisClient.on('error', err => console.error('Redis Client Error', err));
redisClient.on('connect', () => console.log('Redis Client Connected'));
redisClient.on('ready', () => console.log('Redis Client Ready'));

// Conectar ao Redis
(async () => {
  try {
    if (!redisClient.isOpen) {
      await redisClient.connect();
      console.log('Redis conectado com sucesso');
    }
  } catch (error) {
    console.error('Erro ao conectar ao Redis:', error);
    console.warn('Aplicação continuará sem Redis (modo fallback)');
  }
})();

// Helper functions para Redis
const redisHelpers = {
  // Verificar se Redis está conectado
  isConnected() {
    return redisClient.isReady || redisClient.isOpen;
  },

  // Rooms
  async getRoom(roomId) {
    if (!this.isConnected()) {
      throw new Error('Redis não está conectado');
    }
    const data = await redisClient.get(`room:${roomId}`);
    if (!data) return null;
    const room = JSON.parse(data);
    // Converter users de objeto para Map
    if (room.users) {
      room.users = new Map(Object.entries(room.users));
    }
    // Converter votes de cada atividade de objeto para Map
    if (room.activities) {
      room.activities = room.activities.map(activity => ({
        ...activity,
        votes: activity.votes ? new Map(Object.entries(activity.votes)) : new Map()
      }));
    }
    return room;
  },

  async saveRoom(roomId, room) {
    if (!this.isConnected()) {
      throw new Error('Redis não está conectado');
    }
    // Converter Map para objeto para serialização
    const roomData = {
      ...room,
      users: room.users ? Object.fromEntries(room.users) : {},
      activities: room.activities ? room.activities.map(activity => ({
        ...activity,
        votes: activity.votes ? Object.fromEntries(activity.votes) : {}
      })) : []
    };
    await redisClient.set(`room:${roomId}`, JSON.stringify(roomData));
    // Manter lista de IDs de salas
    await redisClient.sAdd('rooms:list', roomId);
  },

  async deleteRoom(roomId) {
    if (!this.isConnected()) {
      throw new Error('Redis não está conectado');
    }
    await redisClient.del(`room:${roomId}`);
    await redisClient.sRem('rooms:list', roomId);
  },

  async getAllRoomIds() {
    if (!this.isConnected()) {
      throw new Error('Redis não está conectado');
    }
    return await redisClient.sMembers('rooms:list');
  },

  // Users
  async getUser(userId) {
    if (!this.isConnected()) {
      throw new Error('Redis não está conectado');
    }
    const data = await redisClient.get(`user:${userId}`);
    return data ? JSON.parse(data) : null;
  },

  async saveUser(userId, user) {
    if (!this.isConnected()) {
      throw new Error('Redis não está conectado');
    }
    await redisClient.set(`user:${userId}`, JSON.stringify(user));
  },

  async deleteUser(userId) {
    if (!this.isConnected()) {
      throw new Error('Redis não está conectado');
    }
    await redisClient.del(`user:${userId}`);
  },

  async getRoomsCount() {
    if (!this.isConnected()) {
      return 0;
    }
    return await redisClient.sCard('rooms:list');
  },

  // Verificar e excluir sala se estiver vazia
  async cleanupEmptyRoom(roomId) {
    if (!this.isConnected()) {
      return false;
    }
    try {
      const room = await this.getRoom(roomId);
      if (!room) {
        return false; // Sala já não existe
      }

      // Verificar se a sala está vazia (sem usuários)
      if (!room.users || room.users.size === 0) {
        console.log(`[cleanup] Sala ${roomId} está vazia, excluindo...`);
        await this.deleteRoom(roomId);
        return true; // Sala foi excluída
      }
      return false; // Sala ainda tem usuários
    } catch (error) {
      console.error(`[cleanupEmptyRoom] Erro ao verificar sala ${roomId}:`, error);
      return false;
    }
  }
};

// Health check
app.get('/health', async (req, res) => {
  try {
    const roomsCount = await redisHelpers.getRoomsCount();
    res.json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      roomsCount: roomsCount,
      redis: redisClient.isReady ? 'connected' : 'disconnected'
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'error', 
      message: error.message,
      redis: redisClient.isReady ? 'connected' : 'disconnected'
    });
  }
});

// Debug: Listar todas as salas (apenas para desenvolvimento)
app.get('/api/rooms', async (req, res) => {
  try {
    const roomIds = await redisHelpers.getAllRoomIds();
    const roomsList = await Promise.all(
      roomIds.map(async (roomId) => {
        const room = await redisHelpers.getRoom(roomId);
        if (!room) return null;
        return {
          id: room.id,
          name: room.name,
          usersCount: room.users ? room.users.size : 0,
          activitiesCount: room.activities ? room.activities.length : 0
        };
      })
    );
    
    res.json({
      total: roomsList.filter(r => r !== null).length,
      rooms: roomsList.filter(r => r !== null)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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
app.post('/api/rooms', async (req, res) => {
  try {
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

    await redisHelpers.saveRoom(roomId, room);
    console.log(`[POST /api/rooms] Sala criada: ${roomId} - ${name}`);
    const roomsCount = await redisHelpers.getRoomsCount();
    console.log(`[DEBUG] Total de salas após criação: ${roomsCount}`);

    // Criar usuário dono da sala
    const owner = {
      id: ownerId,
      name: ownerName,
      roomId: roomId
    };
    await redisHelpers.saveUser(ownerId, owner);

    res.json({
      roomId: roomId,
      userId: ownerId,
      roomName: name,
      shareLink: `${req.protocol}://${req.get('host')}/room/${roomId}`
    });
  } catch (error) {
    console.error('[POST /api/rooms] Erro:', error);
    res.status(500).json({ error: 'Erro ao criar sala', message: error.message });
  }
});

// Obter informações de uma sala
app.get('/api/rooms/:roomId', async (req, res) => {
  try {
    const { roomId } = req.params;
    console.log(`[GET /api/rooms/${roomId}] Buscando sala...`);
    const roomsCount = await redisHelpers.getRoomsCount();
    console.log(`[DEBUG] Total de salas no Redis: ${roomsCount}`);
    
    const room = await redisHelpers.getRoom(roomId);

    if (!room) {
      console.log(`[ERROR] Sala ${roomId} não encontrada`);
      return res.status(404).json({ 
        error: 'Sala não encontrada',
        roomId: roomId,
        availableRooms: roomsCount
      });
    }
    
    console.log(`[SUCCESS] Sala ${roomId} encontrada: ${room.name}`);

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
  } catch (error) {
    console.error(`[GET /api/rooms/${req.params.roomId}] Erro:`, error);
    res.status(500).json({ error: 'Erro ao buscar sala', message: error.message });
  }
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log(`[Socket.io] Usuário conectado: ${socket.id}`);

  // Entrar em uma sala
  socket.on('join-room', async ({ roomId, userId, userName }) => {
    try {
      const room = await redisHelpers.getRoom(roomId);

      if (!room) {
        socket.emit('error', { message: 'Sala não encontrada' });
        return;
      }

      // Verificar se o usuário existe
      let user = await redisHelpers.getUser(userId);
      if (!user) {
        // Criar novo usuário
        user = {
          id: userId,
          name: userName,
          roomId: roomId,
          socketId: socket.id
        };
        await redisHelpers.saveUser(userId, user);
      } else {
        // Atualizar socketId do usuário
        user.socketId = socket.id;
        await redisHelpers.saveUser(userId, user);
      }

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

      // Salvar sala atualizada
      await redisHelpers.saveRoom(roomId, room);

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
    } catch (error) {
      console.error('[join-room] Erro:', error);
      socket.emit('error', { message: 'Erro ao entrar na sala', details: error.message });
    }
  });

  // Criar nova atividade
  socket.on('create-activity', async ({ roomId, userId, title, description }) => {
    try {
      const room = await redisHelpers.getRoom(roomId);

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
      await redisHelpers.saveRoom(roomId, room);

      io.to(roomId).emit('activity-created', {
        id: activity.id,
        title: activity.title,
        description: activity.description,
        status: activity.status
      });

      console.log(`Atividade criada na sala ${roomId}: ${activity.title}`);
    } catch (error) {
      console.error('[create-activity] Erro:', error);
      socket.emit('error', { message: 'Erro ao criar atividade', details: error.message });
    }
  });

  // Iniciar votação de uma atividade
  socket.on('start-voting', async ({ roomId, userId, activityId }) => {
    try {
      const room = await redisHelpers.getRoom(roomId);

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

      await redisHelpers.saveRoom(roomId, room);

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
    } catch (error) {
      console.error('[start-voting] Erro:', error);
      socket.emit('error', { message: 'Erro ao iniciar votação', details: error.message });
    }
  });

  // Votar em uma atividade
  socket.on('vote', async ({ roomId, userId, activityId, vote }) => {
    try {
      const room = await redisHelpers.getRoom(roomId);

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

      await redisHelpers.saveRoom(roomId, room);

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
    } catch (error) {
      console.error('[vote] Erro:', error);
      socket.emit('error', { message: 'Erro ao registrar voto', details: error.message });
    }
  });

  // Revelar resultados
  socket.on('reveal-results', async ({ roomId, userId, activityId }) => {
    try {
      const room = await redisHelpers.getRoom(roomId);

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

      await redisHelpers.saveRoom(roomId, room);

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
    } catch (error) {
      console.error('[reveal-results] Erro:', error);
      socket.emit('error', { message: 'Erro ao revelar resultados', details: error.message });
    }
  });

  // Remover atividade
  socket.on('remove-activity', async ({ roomId, userId, activityId }) => {
    try {
      const room = await redisHelpers.getRoom(roomId);

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

      await redisHelpers.saveRoom(roomId, room);

      io.to(roomId).emit('activity-removed', { activityId: activityId });

      console.log(`Atividade ${activityId} removida da sala ${roomId}`);
    } catch (error) {
      console.error('[remove-activity] Erro:', error);
      socket.emit('error', { message: 'Erro ao remover atividade', details: error.message });
    }
  });

  // Desconectar
  socket.on('disconnect', async () => {
    console.log('Usuário desconectado:', socket.id);

    try {
      // Buscar usuário pelo socketId (precisamos iterar sobre todas as salas)
      const roomIds = await redisHelpers.getAllRoomIds();
      
      for (const roomId of roomIds) {
        const room = await redisHelpers.getRoom(roomId);
        if (room) {
          for (const [userId, user] of room.users.entries()) {
            if (user.socketId === socket.id) {
              const userName = user.name;
              room.users.delete(userId);
              
              // Notificar outros usuários antes de verificar se a sala está vazia
              socket.to(roomId).emit('user-left', {
                userId: userId,
                userName: userName
              });
              
              // Remover usuário do Redis
              await redisHelpers.deleteUser(userId);
              
              // Verificar se a sala ficou vazia após remover este usuário
              if (room.users.size === 0) {
                // Sala está vazia, excluir
                await redisHelpers.cleanupEmptyRoom(roomId);
                console.log(`[disconnect] Sala ${roomId} foi excluída (todos os usuários saíram)`);
              } else {
                // Salvar sala atualizada se ainda tiver usuários
                await redisHelpers.saveRoom(roomId, room);
              }
              
              break;
            }
          }
        }
      }
    } catch (error) {
      console.error('[disconnect] Erro:', error);
    }
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(`Acesse http://localhost:${PORT}`);
});

