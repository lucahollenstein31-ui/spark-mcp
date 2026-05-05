import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createSparkMCPServer } from './index.js';

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'spark-mcp' });
});

// Streamable HTTP endpoint — required by Copilot Studio
app.post('/mcp', async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  const server = createSparkMCPServer();
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.listen(PORT, () => {
  console.log(`Spark MCP HTTP server running on port ${PORT}`);
});