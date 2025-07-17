```mermaid
flowchart TD
    subgraph Клиенты
        A[Браузер 1] -->|HTTPS/WSS| Angie
        B[Браузер 2] -->|HTTPS/WSS| Angie
        C[Мобильное приложение] -->|HTTPS/WSS| Angie
    end

    subgraph Фронтенд
        Angie["Angie (Frontend)"]
        Angie -->|Балансировка нагрузки| Backend1
        Angie -->|Балансировка нагрузки| Backend2
    end

    subgraph Бэкенд-серверы["Бэкенд-серверы (Node.js)"]
        Backend1["Бэкенд 1\n• ((WebSocket\n• JWT-аутентификация\n• Логика чата)"]
        Backend2["Бэкенд 2\n• WebSocket\n• JWT-аутентификация\n• Логика чата"]
    end

    subgraph База данных
        Backend1 DB
    end

    style Angie fill:#4CAF50,color:white
    style Backend1 fill:#2196F3,color:white
    style Backend2 fill:#2196F3,color:white
    style DB fill:#FF9800,color:white
```
