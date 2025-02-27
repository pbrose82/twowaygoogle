// No changes needed to your imports or basic Express setup

// Your existing routes
app.use('/alchemy', alchemyMiddleware);

// Update this line to expose both new and old endpoints for Google Calendar
app.use('/google', googleMiddleware);

// Add a new route for API status
app.get('/status', (req, res) => {
  res.json({
    status: 'ok',
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

// Your existing server listening code
