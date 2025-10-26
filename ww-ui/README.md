# Wizard Warriors UI

Wizard Warriors is a group project I was apart for a CS class and I wanted to remake my own version of it with the knowledge I have acquired since that time.

## Development

### Running with Docker Compose

The entire application (frontend, backend, database) can be run with Docker Compose:

```bash
docker-compose up --build
```

Access the application at [http://localhost](http://localhost)

### Running Locally (Development Mode)

To run the frontend in development mode:

```bash
cd ww-ui
npm install
npm run dev
```

The frontend will be available at [http://localhost:3000](http://localhost:3000)

**Note:** When running locally, make sure the backend server is also running and update the environment variables:
- `NEXT_PUBLIC_API_URL=http://localhost:8080`
- `NEXT_PUBLIC_WS_URL=ws://localhost:8080/game`
