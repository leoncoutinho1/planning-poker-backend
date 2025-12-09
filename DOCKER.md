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
# Use * para permitir qualquer origem, ou especifique origens separadas por vírgula
CORS_ORIGIN=*

# Docker Ports
BACKEND_PORT=3000
FRONTEND_PORT=8080

# Frontend Configuration
# Deixe vazio para usar URLs relativas através do proxy do nginx
# Isso permite acesso externo sem precisar configurar localhost:3000
VITE_API_URL=
VITE_SOCKET_URL=
```

**Importante**: As variáveis `VITE_API_URL` e `VITE_SOCKET_URL` devem estar vazias (ou não definidas) para que o frontend use o proxy do nginx. O nginx já está configurado para fazer proxy de `/api` e `/socket.io` para o backend. Isso permite acesso externo sem problemas de CORS ou URLs hardcoded.

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

### Frontend aponta para localhost:3000

Se o frontend está tentando acessar `localhost:3000` diretamente em vez de usar o proxy do nginx:

1. **Verifique as variáveis de ambiente**: Certifique-se de que `VITE_API_URL` e `VITE_SOCKET_URL` estão vazias ou não definidas no arquivo `.env`:
   ```bash
   VITE_API_URL=
   VITE_SOCKET_URL=
   ```

2. **Reconstrua o frontend**: As variáveis do Vite são incorporadas no build, então é necessário reconstruir:
   ```bash
   docker-compose build --no-cache frontend
   docker-compose up -d frontend
   ```

3. **Verifique o código do frontend**: O frontend deve usar URLs relativas quando as variáveis estão vazias. Se o frontend tem valores padrão hardcoded de `localhost:3000`, será necessário modificar o código do frontend para usar URLs relativas (ex: `/api` e `/socket.io`) quando as variáveis não estiverem definidas.
