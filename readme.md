 to run docker compose file
 if you don't push .env file in github
MONGODB_URI="mongodb://mongo:27017/microservices" \
REDIS_URL="redis://redis:6379" \
RABBITMQ_URL="amqp://rabbitmq:5672" \
IDENTITY_SERVICE_URL="http://identity-service:3001" \
POST_SERVICE_URL="http://post-service:3002" \
MEDIA_SERVICE_URL="http://media-service:3003" \
SEARCH_SERVICE_URL="http://search-service:3004" \
docker-compose up -d --build

ekdum jhakkash!!!