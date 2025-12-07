FROM node:18-alpine

WORKDIR /app

# Copiar arquivos de dependências
COPY package.json yarn.lock* ./

# Instalar dependências com yarn
RUN yarn install --frozen-lockfile --production || yarn install --production

# Copiar código da aplicação
COPY . .

# Expor porta
EXPOSE 3000

# Comando para iniciar a aplicação
CMD ["node", "server.js"]
