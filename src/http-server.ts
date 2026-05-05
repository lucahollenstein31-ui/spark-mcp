import express from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createSparkMCPServer } from './index.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'spark-mcp' });
});

app.get('/sse', async (req, res) => {
  const transport = new SSEServerTransport('/messages', res);
  const server = createSparkMCPServer();
  await server.connect(transport);
});

app.post('/messages', async (req, res) => {
  res.status(200).json({ received: true });
});

app.listen(PORT, () => {
  console.log(`Spark MCP HTTP server running on port ${PORT}`);
});