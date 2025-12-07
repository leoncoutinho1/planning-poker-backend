-- Schema do banco de dados para Planning Poker

-- Habilitar extensão para UUID (se necessário)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Tabela de salas
CREATE TABLE IF NOT EXISTS rooms (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    owner_id UUID NOT NULL,
    current_activity_id UUID,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabela de usuários
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    room_id UUID NOT NULL,
    socket_id VARCHAR(255),
    vote INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
);

-- Tabela de atividades
CREATE TABLE IF NOT EXISTS activities (
    id UUID PRIMARY KEY,
    room_id UUID NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending', 'voting', 'completed'
    result DECIMAL(10, 1),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
);

-- Tabela de votos
CREATE TABLE IF NOT EXISTS votes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    activity_id UUID NOT NULL,
    user_id UUID NOT NULL,
    vote INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(activity_id, user_id)
);

-- Índices para melhor performance
CREATE INDEX IF NOT EXISTS idx_users_room_id ON users(room_id);
CREATE INDEX IF NOT EXISTS idx_users_socket_id ON users(socket_id);
CREATE INDEX IF NOT EXISTS idx_activities_room_id ON activities(room_id);
CREATE INDEX IF NOT EXISTS idx_votes_activity_id ON votes(activity_id);
CREATE INDEX IF NOT EXISTS idx_votes_user_id ON votes(user_id);

-- Trigger para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_rooms_updated_at BEFORE UPDATE ON rooms
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_activities_updated_at BEFORE UPDATE ON activities
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
