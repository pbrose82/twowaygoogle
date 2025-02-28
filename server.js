import express from "express";
import alchemyMiddleware from "./alchemyMiddleware.js";
import googleMiddleware from "./googleMiddleware.js";
import config from "./config.js";

// Create Express app
const app = express();
const { port } = config.server;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Simple request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Direct route handlers for backward compatibility
app.post('/create-event', (req, res) => {
  googleMiddleware(req, res);
});

app.all('/update-alchemy', (req, res) => {
  if (req.method !== 'PUT') req.method = 'PUT';
  alchemyMiddleware(req, res);
});

// Apply route middleware
app.use('/alchemy', alchemyMiddleware);
app.use('/google', googleMiddleware);

// Status endpoint
app.get('/status', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.1.0',
    config: {
      alchemy: {
        tenant: config.alchemy.tenantName,
        configured: !!config.alchemy.refreshToken,
        fields: config.alchemy.fields
      },
      google: {
        configured: !!(config.google.clientId && 
                       config.google.clientSecret && 
                       config.google.refreshToken),
        defaultTimeZone: config.google.defaultTimeZone,
        trackingFile: config.google.trackingFile,
        defaultCalendarId: config.google.defaultCalendarId || 'not set'
      }
    }
  });
});

// Home route
app.get('/', (req, res) => {
  res.json({
    message: "Google Calendar & Alchemy Integration API",
    statusEndpoint: "/status"
  });
});

// Error handlers
app.use((req, res, next) => {
  res.status(404).json({ error: "Not Found", message: `Route not found: ${req.method} ${req.url}` });
});

app.use((err, req, res, next) => {
  console.error(`Error: ${err.message}`);
  res.status(500).json({ error: "Internal Server Error", message: err.message });
});

// Start server
app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on port ${port}`);
  
  // Log configuration
  console.log(`Environment: ${config.server.environment}`);
  console.log(`Alchemy Tenant: ${config.alchemy.tenantName}`);
  console.log(`Google Default Timezone: ${config.google.defaultTimeZone}`);
  
  // Validate configuration
  if (!config.isValid) {
    console.warn("⚠️ Server is running with incomplete configuration!");
  } else {
    console.log("✓ Configuration validated successfully");
  }
});

export default app;
