# Imagen única para los seis servicios de backend (nodo central + nodo
# de cómputo + nodo de agencia): mismo binario, cambia sólo el `command`
# de cada servicio en el compose correspondiente. Ver
# docs/arquitectura-multi-nodo.md.
FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --omit=dev

COPY servidor ./servidor

ENTRYPOINT ["node", "--disable-warning=ExperimentalWarning"]
CMD ["servidor/agregador/index.js"]
