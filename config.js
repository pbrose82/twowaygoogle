import dotenv from "dotenv";

dotenv.config();

/**
 * CONFIGURATION INSTRUCTIONS
 * -------------------------
 * This file defines all configurable settings for the middleware.
 * 
 * To customize for different tenants:
 * 1. Keep this file the same in your code repository
 * 2. Set different environment variables for each deployment
 * 3. The middleware will use the environment variables or fall back to these defaults
 */

const config = {
  // Server configuration
  // -------------------
  // PORT: The port the server will listen on (default: 3000)
  // environment: Development or production mode
  server: {
    port: process.env.PORT || 3000,
    environment: process.env.NODE_ENV || 'production'
  },
  
  // Alchemy configuration
  // --------------------
  // refreshUrl: URL for refreshing Alchemy API tokens
  // updateUrl: URL for updating Alchemy records
  // tenantName: The name of the Alchemy tenant (e.g., "productcaseelnlims4uat")
  // refreshToken: Alchemy refresh token (MUST BE SET in environment variables)
  alchemy: {
    refreshUrl: process.env.ALCHEMY_REFRESH_URL || "https://core-production.alchemy.cloud/core/api/v2/refresh-token",
    updateUrl: process.env.ALCHEMY_UPDATE_URL || "https://core-production.alchemy.cloud/core/api/v2/update-record",
    tenantName: process.env.ALCHEMY_TENANT_NAME || "productcaseelnlims4uat",
    refreshToken: process.env.ALCHEMY_REFRESH_TOKEN,
    
    // Field mappings - these must match the field names in your Alchemy script
    // --------------------------------
    // startField: Field name for start time (default: "StartUse")
    // endField: Field name for end time (default: "EndUse")
    // statusField: Field name for event status (default: "EventStatus")
    fields: {
      startField: process.env.ALCHEMY_START_FIELD || "StartUse",
      endField: process.env.ALCHEMY_END_FIELD || "EndUse",
      statusField: process.env.ALCHEMY_STATUS_FIELD || "EventStatus"
    },
    
    // Event status values - these must match the values expected in Alchemy
    // ----------------------------------
    // pushed: Status when event is created (default: "Pushed to Calendar")
    // cancelled: Status when event is deleted (default: "Removed from Calendar")
    eventStatuses: {
      pushed: process.env.ALCHEMY_STATUS_PUSHED || "Pushed to Calendar",
      cancelled: process.env.ALCHEMY_STATUS_CANCELLED || "Removed from Calendar"
    }
  },
  
  // Google Calendar configuration
  // ---------------------------
  // clientId: Google OAuth client ID (MUST BE SET in environment variables)
  // clientSecret: Google OAuth client secret (MUST BE SET in environment variables)
  // refreshToken: Google OAuth refresh token (MUST BE SET in environment variables)
  // defaultCalendarId: ID of the Google Calendar to use (default: "primary")
  // defaultTimeZone: Timezone for events (default: "America/New_York")
  // trackingFile: Path to store event tracking information
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
    defaultCalendarId: process.env.GOOGLE_DEFAULT_CALENDAR_ID || "primary", // Calendar to send events to
    defaultTimeZone: process.env.GOOGLE_DEFAULT_TIMEZONE || "America/New_York",
    trackingFile: process.env.EVENT_TRACKING_FILE || '/tmp/er_events.json'
  },
  
  // Logging configuration
  // -------------------
  // level: Detail level of logging (default: 'info')
  // colorize: Whether to colorize log output (default: true)
  logging: {
    level: process.env.LOG_LEVEL || 'info', // 'debug', 'info', 'warn', 'error'
    colorize: process.env.LOG_COLORIZE !== 'false'
  }
};

/**
 * VALIDATION
 * ----------
 * Checks if all required environment variables are set.
 * If any are missing, it will log a warning but the server will still run.
 */
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
