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
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  
  // Log environment configuration
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  ['ALCHEMY_REFRESH_TOKEN', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN']
    .forEach(envVar => {
      console.log(`${envVar}: ${process.env[envVar] ? 'configured ✓' : 'missing ✗'}`);
    });
});

export default app;
