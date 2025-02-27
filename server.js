import express from "express";
import alchemyMiddleware from "./alchemyMiddleware.js";
import googleMiddleware from "./googleMiddleware.js";
import dotenv from "dotenv";

dotenv.config();

// Create Express app
const app = express();
const PORT = process.env.PORT || 3000;

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

// Direct route for Google Calendar event creation 
// (for compatibility with existing integrations)
app.post('/create-event', (req, res) => {
  console.log("⚠️ Direct call to /create-event detected, forwarding to /google/create-event");
  req.url = '/create-event';
  googleMiddleware(req, res);
});

// Direct route for Alchemy updates
// (for compatibility with existing integrations)
app.put('/update-alchemy', (req, res) => {
  console.log("⚠️ Direct call to /update-alchemy detected, forwarding to /alchemy/update-alchemy");
  req.url = '/update-alchemy';
  alchemyMiddleware(req, res);
});

// Apply main route middleware
app.use('/alchemy', alchemyMiddleware);
app.use('/google', googleMiddleware);

// Add a status endpoint
app.get('/status', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.2',
    timestamp: new Date().toISOString(),
    alchemy: {
      configured: !!process.env.ALCHEMY_REFRESH_TOKEN
    },
    google: {
      configured: !!(process.env.GOOGLE_CLIENT_ID && 
                    process.env.GOOGLE_CLIENT_SECRET && 
                    process.env.GOOGLE_REFRESH_TOKEN)
    },
    routes: {
      "/create-event": "POST - Create or update Google Calendar event (direct)",
      "/google/create-event": "POST - Create or update Google Calendar event",
      "/google/update-event": "PUT - Update an existing Google Calendar event",
      "/google/delete-event/:recordId": "DELETE - Delete a Google Calendar event",
      "/update-alchemy": "PUT - Update Alchemy from Google Calendar (direct)",
      "/alchemy/update-alchemy": "PUT - Update Alchemy from Google Calendar"
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
      "PUT /update-alchemy",
      "POST /google/create-event", 
      "PUT /google/update-event",
      "DELETE /google/delete-event/:recordId",
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

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`✅ API Status: http://localhost:${PORT}/status`);
  
  // Log environment configuration (without sensitive values)
  console.log("📊 Environment Configuration:");
  console.log(`- NODE_ENV: ${process.env.NODE_ENV || 'not set'}`);
  console.log(`- ALCHEMY_REFRESH_TOKEN: ${process.env.ALCHEMY_REFRESH_TOKEN ? 'configured ✓' : 'missing ✗'}`);
  console.log(`- GOOGLE_CLIENT_ID: ${process.env.GOOGLE_CLIENT_ID ? 'configured ✓' : 'missing ✗'}`);
  console.log(`- GOOGLE_CLIENT_SECRET: ${process.env.GOOGLE_CLIENT_SECRET ? 'configured ✓' : 'missing ✗'}`);
  console.log(`- GOOGLE_REFRESH_TOKEN: ${process.env.GOOGLE_REFRESH_TOKEN ? 'configured ✓' : 'missing ✗'}`);
});

// Handle unhandled exceptions
process.on('uncaughtException', (error) => {
  console.error('🔴 Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🔴 Unhandled Rejection:', reason);
});

export default app;
