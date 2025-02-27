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

// Log all incoming requests
app.use((req, res, next) => {
  console.log(`📥 ${req.method} ${req.url}`);
  next();
});

// Apply routes
app.use('/alchemy', alchemyMiddleware);
app.use('/google', googleMiddleware);

// Add a direct route for update-alchemy (in case it's being called directly)
app.put('/update-alchemy', (req, res) => {
  console.log("⚠️ Direct call to /update-alchemy detected, forwarding to /alchemy/update-alchemy");
  req.url = '/update-alchemy';
  alchemyMiddleware(req, res);
});

// Add a status endpoint
app.get('/status', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.1',
    alchemy: {
      configured: !!process.env.ALCHEMY_REFRESH_TOKEN
    },
    google: {
      configured: !!(process.env.GOOGLE_CLIENT_ID && 
                    process.env.GOOGLE_CLIENT_SECRET && 
                    process.env.GOOGLE_REFRESH_TOKEN)
    }
  });
});

// Home route
app.get('/', (req, res) => {
  res.json({
    message: "Google Calendar & Alchemy Integration API",
    endpoints: {
      "/google/create-event": "Create or update a Google Calendar event",
      "/google/update-event": "Update an existing Google Calendar event",
      "/google/delete-event/:recordId": "Delete a Google Calendar event",
      "/alchemy/update-alchemy": "Update Alchemy from Google Calendar",
      "/status": "Check API status"
    }
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`✅ API Status: http://localhost:${PORT}/status`);
});

// Handle unhandled exceptions
process.on('uncaughtException', (error) => {
  console.error('🔴 Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🔴 Unhandled Rejection:', reason);
});

export default app;
