```mermaid
graph TD;
    Client1[Браузер 1] -->|HTTPS/WSS| Frontend;
    Client2[Браузер 2] -->|HTTPS/WSS| Frontend;
    
    Frontend["Frontend (Angie)
    ▸ Балансировка нагрузки
    ▸ SSL/TLS termination
    ▸ Rate limiting"];
    
    Frontend -->|WebSocket| Backend1;
    Frontend -->|WebSocket| Backend2;
    
    Backend1["Backend 1 (Node.js)
    ▸ WebSocket
    ▸ JWT-аутентификация
    ▸ Логика чата"];
    
    Backend2["Backend 2 (Node.js)
    ▸ WebSocket
    ▸ JWT-аутентификация
    ▸ Логика чата"];
    
    Backend1 -->|Чтение/запись| Redis;
    Backend2 -->|Чтение/запись| Redis;
    
    Redis["Redis
    ▸ Кеш сессий
    ▸ Активные подключения
    ▸ Временные данные"];
    
    Redis -->|Синхронизация| Database;
    
    Database[("Database (PostgreSQL)
    ▸ Пользователи
    ▸ История сообщений
    ▸ Персистентные данные"];
    
    style Frontend fill:#4CAF50,color:white
    style Backend1 fill:#2196F3,color:white
    style Backend2 fill:#2196F3,color:white
    style Redis fill:#E53935,color:white
    style Database fill:#FF9800,color:white
```
