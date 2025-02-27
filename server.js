import express from "express";
import alchemyMiddleware from "./alchemyMiddleware.js";
import googleMiddleware from "./googleMiddleware.js";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

console.log(`Starting server with PORT=${PORT}`);

// Basic middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Basic logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Apply routes
app.use('/google', googleMiddleware);
app.use('/alchemy', alchemyMiddleware);

// Direct route handling for backward compatibility
app.post('/create-event', (req, res) => {
  console.log("Direct call to /create-event, forwarding to /google/create-event");
  req.url = '/create-event';
  googleMiddleware(req, res);
});

app.all('/update-alchemy', (req, res) => {
  console.log(`Direct call to ${req.method} /update-alchemy, forwarding to /alchemy/update-alchemy`);
  req.url = '/update-alchemy';
  if (req.method !== 'PUT') req.method = 'PUT';
  alchemyMiddleware(req, res);
});

// Simple home route
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok',
    message: 'Calendar Middleware API running' 
  });
});

// Simple status route
app.get('/status', (req, res) => {
  res.json({
    status: 'running',
    version: '1.0.0',
    port: PORT,
    environment: process.env.NODE_ENV || 'development'
  });
});

// CRITICAL: Use the correct port binding syntax for Render
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Server accessible at: http://localhost:${PORT}`);
});

// For debugging - print environment variables
console.log("Environment variables:");
console.log(`- NODE_ENV: ${process.env.NODE_ENV || 'not set'}`);
console.log(`- PORT: ${PORT}`);
console.log(`- GOOGLE_CLIENT_ID: ${process.env.GOOGLE_CLIENT_ID ? 'set' : 'not set'}`);
console.log(`- GOOGLE_CLIENT_SECRET: ${process.env.GOOGLE_CLIENT_SECRET ? 'set' : 'not set'}`);
console.log(`- GOOGLE_REFRESH_TOKEN: ${process.env.GOOGLE_REFRESH_TOKEN ? 'set' : 'not set'}`);
console.log(`- ALCHEMY_REFRESH_TOKEN: ${process.env.ALCHEMY_REFRESH_TOKEN ? 'set' : 'not set'}`);
console.log(`- EVENT_TRACKING_FILE: ${process.env.EVENT_TRACKING_FILE || 'not set'}`);

// Export the app for testing
export default app;
