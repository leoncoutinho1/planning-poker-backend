require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const { Pool } = require('pg');

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

// Configurar PostgreSQL
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'planning_poker',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

// Testar conexão
(async () => {
  try {
    const client = await pool.connect();
    console.log('PostgreSQL conectado com sucesso');
    client.release();
  } catch (error) {
    console.error('Erro ao conectar ao PostgreSQL:', error);
    console.warn('Aplicação continuará tentando conectar...');
  }
})();

// Helper functions para PostgreSQL
const dbHelpers = {
  // Verificar se PostgreSQL está conectado
  async isConnected() {
    try {
      const client = await pool.connect();
      client.release();
      return true;
    } catch (error) {
      return false;
    }
  },

  // Rooms
  async getRoom(roomId) {
    const client = await pool.connect();
    try {
      // Buscar sala
      const roomResult = await client.query(
        'SELECT * FROM rooms WHERE id = $1',
        [roomId]
      );

      if (roomResult.rows.length === 0) {
        return null;
      }

      const room = roomResult.rows[0];

      // Buscar usuários da sala
      const usersResult = await client.query(
        'SELECT id, name, socket_id, vote FROM users WHERE room_id = $1',
        [roomId]
      );

      const users = new Map();
      usersResult.rows.forEach(user => {
        users.set(user.id, {
          id: user.id,
          name: user.name,
          socketId: user.socket_id,
          vote: user.vote
        });
      });

      // Buscar atividades da sala
      const activitiesResult = await client.query(
        'SELECT * FROM activities WHERE room_id = $1 ORDER BY created_at',
        [roomId]
      );

      const activities = await Promise.all(
        activitiesResult.rows.map(async (activity) => {
          // Buscar votos da atividade
          const votesResult = await client.query(
            'SELECT user_id, vote FROM votes WHERE activity_id = $1',
            [activity.id]
          );

          const votes = new Map();
          votesResult.rows.forEach(vote => {
            votes.set(vote.user_id, vote.vote);
          });

          return {
            id: activity.id,
            title: activity.title,
            description: activity.description,
            votes: votes,
            status: activity.status,
            result: activity.result ? parseFloat(activity.result) : null
          };
        })
      );

      return {
        id: room.id,
        name: room.name,
        ownerId: room.owner_id,
        users: users,
        activities: activities,
        currentActivityId: room.current_activity_id
      };
    } finally {
      client.release();
    }
  },

  async saveRoom(roomId, room) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Atualizar ou inserir sala
      await client.query(
        `INSERT INTO rooms (id, name, owner_id, current_activity_id, updated_at)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           owner_id = EXCLUDED.owner_id,
           current_activity_id = EXCLUDED.current_activity_id,
           updated_at = CURRENT_TIMESTAMP`,
        [roomId, room.name, room.ownerId, room.currentActivityId]
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  async deleteRoom(roomId) {
    const client = await pool.connect();
    try {
      // CASCADE vai deletar usuários, atividades e votos automaticamente
      await client.query('DELETE FROM rooms WHERE id = $1', [roomId]);
    } finally {
      client.release();
    }
  },

  async getAllRoomIds() {
    const client = await pool.connect();
    try {
      const result = await client.query('SELECT id FROM rooms');
      return result.rows.map(row => row.id);
    } finally {
      client.release();
    }
  },

  // Users
  async getUser(userId) {
    const client = await pool.connect();
    try {
      const result = await client.query(
        'SELECT * FROM users WHERE id = $1',
        [userId]
      );
      if (result.rows.length === 0) return null;
      const user = result.rows[0];
      return {
        id: user.id,
        name: user.name,
        roomId: user.room_id,
        socketId: user.socket_id
      };
    } finally {
      client.release();
    }
  },

  async saveUser(userId, user) {
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO users (id, name, room_id, socket_id, vote, updated_at)
         VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           room_id = EXCLUDED.room_id,
           socket_id = EXCLUDED.socket_id,
           vote = EXCLUDED.vote,
           updated_at = CURRENT_TIMESTAMP`,
        [userId, user.name, user.roomId, user.socketId || null, user.vote || null]
      );
    } finally {
      client.release();
    }
  },

  async updateUserSocketId(userId, socketId) {
    const client = await pool.connect();
    try {
      await client.query(
        'UPDATE users SET socket_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [socketId, userId]
      );
    } finally {
      client.release();
    }
  },

  async updateUserVote(userId, vote) {
    const client = await pool.connect();
    try {
      await client.query(
        'UPDATE users SET vote = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [vote, userId]
      );
    } finally {
      client.release();
    }
  },

  async resetUsersVotes(roomId) {
    const client = await pool.connect();
    try {
      await client.query(
        'UPDATE users SET vote = NULL, updated_at = CURRENT_TIMESTAMP WHERE room_id = $1',
        [roomId]
      );
    } finally {
      client.release();
    }
  },

  async deleteUser(userId) {
    const client = await pool.connect();
    try {
      await client.query('DELETE FROM users WHERE id = $1', [userId]);
    } finally {
      client.release();
    }
  },

  async getRoomsCount() {
    const client = await pool.connect();
    try {
      const result = await client.query('SELECT COUNT(*) FROM rooms');
      return parseInt(result.rows[0].count);
    } finally {
      client.release();
    }
  },

  // Activities
  async createActivity(activityId, roomId, title, description) {
    const client = await pool.connect();
    try {
      await client.query(
        'INSERT INTO activities (id, room_id, title, description, status) VALUES ($1, $2, $3, $4, $5)',
        [activityId, roomId, title, description, 'pending']
      );
    } finally {
      client.release();
    }
  },

  async updateActivityStatus(activityId, status, result = null) {
    const client = await pool.connect();
    try {
      await client.query(
        'UPDATE activities SET status = $1, result = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
        [status, result, activityId]
      );
    } finally {
      client.release();
    }
  },

  async deleteActivity(activityId) {
    const client = await pool.connect();
    try {
      // CASCADE vai deletar votos automaticamente
      await client.query('DELETE FROM activities WHERE id = $1', [activityId]);
    } finally {
      client.release();
    }
  },

  // Votes
  async saveVote(activityId, userId, vote) {
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO votes (activity_id, user_id, vote)
         VALUES ($1, $2, $3)
         ON CONFLICT (activity_id, user_id) DO UPDATE SET vote = EXCLUDED.vote`,
        [activityId, userId, vote]
      );
    } finally {
      client.release();
    }
  },

  async deleteVotesForActivity(activityId) {
    const client = await pool.connect();
    try {
      await client.query('DELETE FROM votes WHERE activity_id = $1', [activityId]);
    } finally {
      client.release();
    }
  },

  async getVotesForActivity(activityId) {
    const client = await pool.connect();
    try {
      const result = await client.query(
        'SELECT user_id, vote FROM votes WHERE activity_id = $1',
        [activityId]
      );
      const votes = new Map();
      result.rows.forEach(row => {
        votes.set(row.user_id, row.vote);
      });
      return votes;
    } finally {
      client.release();
    }
  },

  async getUserBySocketId(socketId) {
    const client = await pool.connect();
    try {
      const result = await client.query(
        'SELECT * FROM users WHERE socket_id = $1',
        [socketId]
      );
      if (result.rows.length === 0) return null;
      const user = result.rows[0];
      return {
        id: user.id,
        name: user.name,
        roomId: user.room_id,
        socketId: user.socket_id
      };
    } finally {
      client.release();
    }
  },

  // Verificar e excluir sala se estiver vazia
  async cleanupEmptyRoom(roomId) {
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
    const isConnected = await dbHelpers.isConnected();
    const roomsCount = await dbHelpers.getRoomsCount();
    res.json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      roomsCount: roomsCount,
      database: isConnected ? 'connected' : 'disconnected'
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'error', 
      message: error.message,
      database: 'error'
    });
  }
});

// Debug: Listar todas as salas (apenas para desenvolvimento)
app.get('/api/rooms', async (req, res) => {
  try {
    const roomIds = await dbHelpers.getAllRoomIds();
    const roomsList = await Promise.all(
      roomIds.map(async (roomId) => {
        const room = await dbHelpers.getRoom(roomId);
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

// Criar uma nova sala
app.post('/api/rooms', async (req, res) => {
  const client = await pool.connect();
  try {
    const { name, ownerName } = req.body;

    if (!name || !ownerName) {
      return res.status(400).json({ error: 'Nome da sala e nome do usuário são obrigatórios' });
    }

    await client.query('BEGIN');

    const roomId = uuidv4();
    const ownerId = uuidv4();

    // Criar sala
    await client.query(
      'INSERT INTO rooms (id, name, owner_id) VALUES ($1, $2, $3)',
      [roomId, name, ownerId]
    );

    // Criar usuário dono da sala
    await client.query(
      'INSERT INTO users (id, name, room_id) VALUES ($1, $2, $3)',
      [ownerId, ownerName, roomId]
    );

    await client.query('COMMIT');

    console.log(`[POST /api/rooms] Sala criada: ${roomId} - ${name}`);
    const roomsCount = await dbHelpers.getRoomsCount();
    console.log(`[DEBUG] Total de salas após criação: ${roomsCount}`);

    res.json({
      roomId: roomId,
      userId: ownerId,
      roomName: name,
      shareLink: `${req.protocol}://${req.get('host')}/room/${roomId}`
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[POST /api/rooms] Erro:', error);
    res.status(500).json({ error: 'Erro ao criar sala', message: error.message });
  } finally {
    client.release();
  }
});

// Obter informações de uma sala
app.get('/api/rooms/:roomId', async (req, res) => {
  try {
    const { roomId } = req.params;
    console.log(`[GET /api/rooms/${roomId}] Buscando sala...`);
    const roomsCount = await dbHelpers.getRoomsCount();
    console.log(`[DEBUG] Total de salas no PostgreSQL: ${roomsCount}`);
    
    const room = await dbHelpers.getRoom(roomId);

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
      const room = await dbHelpers.getRoom(roomId);

      if (!room) {
        socket.emit('error', { message: 'Sala não encontrada' });
        return;
      }

      // Verificar se o usuário existe
      let user = await dbHelpers.getUser(userId);
      if (!user) {
        // Criar novo usuário
        user = {
          id: userId,
          name: userName,
          roomId: roomId,
          socketId: socket.id
        };
        await dbHelpers.saveUser(userId, user);
      } else {
        // Atualizar socketId do usuário
        await dbHelpers.updateUserSocketId(userId, socket.id);
        user.socketId = socket.id;
      }

      // Adicionar usuário à sala se ainda não estiver
      if (!room.users.has(userId)) {
        await dbHelpers.saveUser(userId, {
          id: userId,
          name: userName,
          roomId: roomId,
          socketId: socket.id,
          vote: null
        });
      }

      socket.join(roomId);

      // Buscar sala atualizada
      const updatedRoom = await dbHelpers.getRoom(roomId);

      // Notificar outros usuários
      socket.to(roomId).emit('user-joined', {
        userId: user.id,
        userName: user.name
      });

      // Enviar estado atual da sala para o novo usuário
      socket.emit('room-state', {
        room: {
          id: updatedRoom.id,
          name: updatedRoom.name,
          ownerId: updatedRoom.ownerId
        },
        users: Array.from(updatedRoom.users.values()).map(u => ({
          id: u.id,
          name: u.name
        })),
        activities: updatedRoom.activities.map(a => ({
          id: a.id,
          title: a.title,
          description: a.description,
          status: a.status,
          result: a.result
        })),
        currentActivityId: updatedRoom.currentActivityId
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
      const room = await dbHelpers.getRoom(roomId);

      if (!room) {
        socket.emit('error', { message: 'Sala não encontrada' });
        return;
      }

      const activityId = uuidv4();
      await dbHelpers.createActivity(activityId, roomId, title || 'Nova Atividade', description || '');

      io.to(roomId).emit('activity-created', {
        id: activityId,
        title: title || 'Nova Atividade',
        description: description || '',
        status: 'pending'
      });

      console.log(`Atividade criada na sala ${roomId}: ${title || 'Nova Atividade'}`);
    } catch (error) {
      console.error('[create-activity] Erro:', error);
      socket.emit('error', { message: 'Erro ao criar atividade', details: error.message });
    }
  });

  // Iniciar votação de uma atividade
  socket.on('start-voting', async ({ roomId, userId, activityId }) => {
    try {
      const room = await dbHelpers.getRoom(roomId);

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
      await dbHelpers.deleteVotesForActivity(activityId);
      await dbHelpers.updateActivityStatus(activityId, 'voting');
      await dbHelpers.resetUsersVotes(roomId);

      // Atualizar currentActivityId da sala
      room.currentActivityId = activityId;
      await dbHelpers.saveRoom(roomId, room);

      io.to(roomId).emit('voting-started', {
        activityId: activityId,
        activity: {
          id: activity.id,
          title: activity.title,
          description: activity.description,
          status: 'voting'
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
      const room = await dbHelpers.getRoom(roomId);

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
      await dbHelpers.saveVote(activityId, userId, vote);
      await dbHelpers.updateUserVote(userId, vote);

      // Notificar todos na sala sobre o voto (sem revelar o valor)
      io.to(roomId).emit('vote-received', {
        activityId: activityId,
        userId: userId,
        userName: user.name,
        hasVoted: true
      });

      // Verificar se todos votaram
      const updatedRoom = await dbHelpers.getRoom(roomId);
      const allUsersVoted = Array.from(updatedRoom.users.values()).every(u => u.vote !== null);
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
      const room = await dbHelpers.getRoom(roomId);

      if (!room) {
        socket.emit('error', { message: 'Sala não encontrada' });
        return;
      }

      const activity = room.activities.find(a => a.id === activityId);
      if (!activity) {
        socket.emit('error', { message: 'Atividade não encontrada' });
        return;
      }

      // Buscar votos atualizados
      const votes = await dbHelpers.getVotesForActivity(activityId);

      // Calcular média dos votos
      const votesArray = Array.from(votes.values());
      const average = votesArray.length > 0
        ? votesArray.reduce((sum, vote) => sum + vote, 0) / votesArray.length
        : 0;

      const result = Math.round(average * 10) / 10; // Arredondar para 1 casa decimal

      await dbHelpers.updateActivityStatus(activityId, 'completed', result);
      
      room.currentActivityId = null;
      await dbHelpers.saveRoom(roomId, room);

      // Preparar resultados detalhados
      const results = Array.from(votes.entries()).map(([userId, vote]) => {
        const user = room.users.get(userId);
        return {
          userId: userId,
          userName: user ? user.name : 'Desconhecido',
          vote: vote
        };
      });

      io.to(roomId).emit('results-revealed', {
        activityId: activityId,
        result: result,
        votes: results
      });

      console.log(`Resultados revelados para atividade ${activityId}: ${result}`);
    } catch (error) {
      console.error('[reveal-results] Erro:', error);
      socket.emit('error', { message: 'Erro ao revelar resultados', details: error.message });
    }
  });

  // Remover atividade
  socket.on('remove-activity', async ({ roomId, userId, activityId }) => {
    try {
      const room = await dbHelpers.getRoom(roomId);

      if (!room) {
        socket.emit('error', { message: 'Sala não encontrada' });
        return;
      }

      const activity = room.activities.find(a => a.id === activityId);
      if (!activity) {
        socket.emit('error', { message: 'Atividade não encontrada' });
        return;
      }

      await dbHelpers.deleteActivity(activityId);

      if (room.currentActivityId === activityId) {
        room.currentActivityId = null;
        await dbHelpers.saveRoom(roomId, room);
      }

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
      // Buscar usuário pelo socketId
      const user = await dbHelpers.getUserBySocketId(socket.id);
      
      if (user) {
        const room = await dbHelpers.getRoom(user.roomId);
        if (room) {
          const userName = user.name;
          
          // Notificar outros usuários antes de verificar se a sala está vazia
          socket.to(user.roomId).emit('user-left', {
            userId: user.id,
            userName: userName
          });
          
          // Remover usuário
          await dbHelpers.deleteUser(user.id);
          
          // Verificar se a sala ficou vazia após remover este usuário
          const updatedRoom = await dbHelpers.getRoom(user.roomId);
          if (!updatedRoom || updatedRoom.users.size === 0) {
            // Sala está vazia, excluir
            await dbHelpers.cleanupEmptyRoom(user.roomId);
            console.log(`[disconnect] Sala ${user.roomId} foi excluída (todos os usuários saíram)`);
          }
        }
      }
    } catch (error) {
      console.error('[disconnect] Erro:', error);
    }
  });
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, HOST, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(`Acesse http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
});
