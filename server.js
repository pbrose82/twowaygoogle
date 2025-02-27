import express from "express";
import alchemyMiddleware from "./alchemyMiddleware.js";
import googleMiddleware from "./googleMiddleware.js";
import dotenv from "dotenv";

dotenv.config();

// Create Express app
const app = express();
const PORT = process.env.PORT || 10000; // Using Render's PORT environment variable or fallback to 10000

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Log all incoming requests
app.use((req, res, next) => {
  console.log(`📥 REQUEST: ${req.method} ${req.originalUrl}`);
  
  // Log request headers
  console.log("📋 Headers:", JSON.stringify(req.headers, null, 2));
  
  // Log request body
  if (req.body && Object.keys(req.body).length > 0) {
    console.log("📦 Body:", JSON.stringify(req.body, null, 2));
  }
  
  // Capture and log response
  const originalSend = res.send;
  res.send = function(data) {
    console.log(`📤 RESPONSE (${res.statusCode}):`, data.substring ? data.substring(0, 500) : data);
    return originalSend.apply(res, arguments);
  };
  
  next();
});

// Direct routes for backward compatibility - SUPPORT BOTH PUT AND POST
app.post('/create-event', (req, res) => {
  console.log("⚠️ Direct call to /create-event detected, forwarding to /google/create-event");
  req.url = '/create-event';
  googleMiddleware(req, res);
});

// Support both PUT and POST for update-alchemy
app.put('/update-alchemy', (req, res) => {
  console.log("⚠️ Direct call to PUT /update-alchemy detected, forwarding to /alchemy/update-alchemy");
  req.url = '/update-alchemy';
  alchemyMiddleware(req, res);
});

app.post('/update-alchemy', (req, res) => {
  console.log("⚠️ Direct call to POST /update-alchemy detected, forwarding to /alchemy/update-alchemy");
  req.url = '/update-alchemy';
  req.method = 'PUT'; // Convert to PUT since alchemyMiddleware expects PUT
  alchemyMiddleware(req, res);
});

// Apply main route middleware
app.use('/alchemy', alchemyMiddleware);
app.use('/google', googleMiddleware);

// Add a status endpoint
app.get('/status', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.3',
    timestamp: new Date().toISOString(),
    alchemy: {
      configured: !!process.env.ALCHEMY_REFRESH_TOKEN
    },
    google: {
      configured: !!(process.env.GOOGLE_CLIENT_ID && 
                    process.env.GOOGLE_CLIENT_SECRET && 
                    process.env.GOOGLE_REFRESH_TOKEN)
    },
    eventTracking: {
      file: process.env.EVENT_TRACKING_FILE || '/tmp/event_tracking.json'
    },
    routes: {
      "/create-event": "POST - Create or update Google Calendar event (direct)",
      "/update-alchemy": "POST or PUT - Update Alchemy from Google Calendar (direct)",
      "/google/create-event": "POST - Create or update Google Calendar event",
      "/google/update-event": "PUT - Update an existing Google Calendar event",
      "/google/delete-event/:recordId": "DELETE - Delete a Google Calendar event",
      "/google/tracked-events": "GET - View all tracked events (debug)",
      "/alchemy/update-alchemy": "PUT - Update Alchemy from Google Calendar",
      "/status": "GET - API status and configuration"
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

// 404 handler (JSON response instead of HTML)
app.use((req, res, next) => {
  res.status(404).json({
    error: "Not Found",
    message: `Route not found: ${req.method} ${req.originalUrl}`,
    availableRoutes: [
      "POST /create-event",
      "POST or PUT /update-alchemy",
      "POST /google/create-event", 
      "PUT /google/update-event",
      "DELETE /google/delete-event/:recordId",
      "GET /google/tracked-events",
      "PUT /alchemy/update-alchemy",
      "GET /status"
    ]
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error("🔴 Express error:", err);
  res.status(500).json({
    error: "Internal Server Error",
    message: err.message,
    stack: process.env.NODE_ENV === 'production' ? '(hidden in production)' : err.stack
  });
});

// IMPORTANT: Start server with explicit port binding and logging
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`✅ Server listening on http://0.0.0.0:${PORT}`);
  console.log(`✅ API Status: http://localhost:${PORT}/status`);
  
  // Log environment configuration (without sensitive values)
  console.log("📊 Environment Configuration:");
  console.log(`- NODE_ENV: ${process.env.NODE_ENV || 'not set'}`);
  console.log(`- PORT: ${PORT}`);
  console.log(`- ALCHEMY_REFRESH_TOKEN: ${process.env.ALCHEMY_REFRESH_TOKEN ? 'configured ✓' : 'missing ✗'}`);
  console.log(`- GOOGLE_CLIENT_ID: ${process.env.GOOGLE_CLIENT_ID ? 'configured ✓' : 'missing ✗'}`);
  console.log(`- GOOGLE_CLIENT_SECRET: ${process.env.GOOGLE_CLIENT_SECRET ? 'configured ✓' : 'missing ✗'}`);
  console.log(`- GOOGLE_REFRESH_TOKEN: ${process.env.GOOGLE_REFRESH_TOKEN ? 'configured ✓' : 'missing ✗'}`);
  console.log(`- EVENT_TRACKING_FILE: ${process.env.EVENT_TRACKING_FILE || '/tmp/event_tracking.json'}`);
});

// Handle unhandled exceptions
process.on('uncaughtException', (error) => {
  console.error('🔴 Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🔴 Unhandled Rejection:', reason);
});

export default app;
