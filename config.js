import dotenv from "dotenv";

dotenv.config();

const config = {
  // Server configuration
  server: {
    port: process.env.PORT || 3000,
    environment: process.env.NODE_ENV || 'production'
  },
  
  // Alchemy configuration
  alchemy: {
    refreshUrl: process.env.ALCHEMY_REFRESH_URL || "https://core-production.alchemy.cloud/core/api/v2/refresh-token",
    updateUrl: process.env.ALCHEMY_UPDATE_URL || "https://core-production.alchemy.cloud/core/api/v2/update-record",
    tenantName: process.env.ALCHEMY_TENANT_NAME || "productcaseelnlims4uat",
    refreshToken: process.env.ALCHEMY_REFRESH_TOKEN,
    // Field mappings
    fields: {
      startField: process.env.ALCHEMY_START_FIELD || "StartUse",
      endField: process.env.ALCHEMY_END_FIELD || "EndUse",
      statusField: process.env.ALCHEMY_STATUS_FIELD || "EventStatus"
    },
    // Event status values
    eventStatuses: {
      pushed: process.env.ALCHEMY_STATUS_PUSHED || "Pushed to Calendar",
      cancelled: process.env.ALCHEMY_STATUS_CANCELLED || "Removed From Calendar"
    }
  },
  
  // Google Calendar configuration
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
    defaultCalendarId: process.env.GOOGLE_DEFAULT_CALENDAR_ID || "primary", // Calendar to send events to
    defaultTimeZone: process.env.GOOGLE_DEFAULT_TIMEZONE || "America/New_York",
    trackingFile: process.env.EVENT_TRACKING_FILE || '/tmp/er_events.json'
  },
  
  // Logging configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info', // 'debug', 'info', 'warn', 'error'
    colorize: process.env.LOG_COLORIZE !== 'false'
  }
};

// Validate required configuration
function validateConfig() {
  const requiredVars = [
    { path: 'alchemy.refreshToken', name: 'ALCHEMY_REFRESH_TOKEN' },
    { path: 'google.clientId', name: 'GOOGLE_CLIENT_ID' },
    { path: 'google.clientSecret', name: 'GOOGLE_CLIENT_SECRET' },
    { path: 'google.refreshToken', name: 'GOOGLE_REFRESH_TOKEN' }
  ];
  
  const missingVars = requiredVars.filter(v => {
    const parts = v.path.split('.');
    let current = config;
    for (const part of parts) {
      if (current[part] === undefined) return true;
      current = current[part];
    }
    return !current;
  });
  
  if (missingVars.length > 0) {
    const missingList = missingVars.map(v => v.name).join(', ');
    console.warn(`⚠️ Missing required environment variables: ${missingList}`);
  }
  
  return missingVars.length === 0;
}

config.isValid = validateConfig();

export default config;
