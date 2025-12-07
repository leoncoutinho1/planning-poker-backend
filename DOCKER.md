# Docker Setup - Planning Poker

Este projeto está containerizado usando Docker e Docker Compose.

## Estrutura

- **PostgreSQL**: Banco de dados
- **Backend**: API Node.js com Socket.io
- **Frontend**: Aplicação React/Vite servida com Nginx

## Pré-requisitos

- Docker
- Docker Compose

## Configuração

1. Copie o arquivo `.env.example` para `.env` (se necessário) e ajuste as variáveis:

```bash
# Database Configuration
DB_HOST=postgres
DB_PORT=5432
DB_NAME=planning_poker
DB_USER=postgres
DB_PASSWORD=postgres

# Server Configuration
PORT=3000
NODE_ENV=production

# CORS Configuration
CORS_ORIGIN=*

# Docker Ports
BACKEND_PORT=3000
FRONTEND_PORT=80
```

## Execução

### Iniciar todos os serviços

```bash
docker-compose up -d
```

### Ver logs

```bash
# Todos os serviços
docker-compose logs -f

# Apenas backend
docker-compose logs -f backend

# Apenas frontend
docker-compose logs -f frontend

# Apenas banco de dados
docker-compose logs -f postgres
```

### Parar todos os serviços

```bash
docker-compose down
```

### Parar e remover volumes (limpar dados)

```bash
docker-compose down -v
```

### Reconstruir imagens

```bash
docker-compose build --no-cache
```

## Acessos

- **Frontend**: http://localhost:80 (ou porta configurada em `FRONTEND_PORT`)
- **Backend API**: http://localhost:3000 (ou porta configurada em `BACKEND_PORT`)
- **PostgreSQL**: localhost:5432 (ou porta configurada em `DB_PORT`)

## Desenvolvimento

Para desenvolvimento, você pode:

1. Executar apenas o banco de dados com Docker:
```bash
docker-compose up -d postgres
```

2. Executar backend e frontend localmente (fora do Docker) apontando para o banco containerizado.

## Troubleshooting

### Banco de dados não inicia

Verifique se a porta 5432 não está em uso:
```bash
docker-compose logs postgres
```

### Backend não conecta ao banco

Verifique se o serviço `postgres` está saudável:
```bash
docker-compose ps
```

O healthcheck do PostgreSQL deve estar `healthy`.

### Frontend não carrega

Verifique os logs do frontend:
```bash
docker-compose logs frontend
```

Certifique-se de que o build do frontend foi concluído com sucesso.
