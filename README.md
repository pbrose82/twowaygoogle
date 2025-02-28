# Google Calendar & Alchemy Integration Middleware

This middleware enables bidirectional synchronization between Google Calendar and Alchemy:

- Updates from Google Calendar are pushed to Alchemy
- Updates from Alchemy are pushed to Google Calendar, with duplicate prevention

## Features

- **Bidirectional Sync**: Keep Google Calendar and Alchemy in sync
- **Duplicate Prevention**: Updates existing Google Calendar events instead of creating duplicates
- **Deleted Event Handling**: Properly recreates events that were deleted in Google
- **Event Tracking**: Persistent tracking of the relationship between Alchemy records and Google events

## Setup

### Prerequisites

- Node.js 16 or higher
- Google Calendar API credentials
- Alchemy API credentials

### Installation

1. Clone this repository
2. Install dependencies:
   ```
   npm install
   ```
3. Set up environment variables (see below)
4. Start the server:
   ```
   npm start
   ```

### Environment Variables

Create a `.env` file with the following variables:

```
# Google Calendar API credentials
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REFRESH_TOKEN=your_refresh_token

# Alchemy API credentials
ALCHEMY_REFRESH_TOKEN=your_refresh_token

# Optional configuration
PORT=3000
EVENT_TRACKING_FILE=/tmp/er_events.json
```

## API Endpoints

### Google Calendar Integration

- **POST /google/create-event**: Create or update a Google Calendar event
- **GET /google/tracked-events**: Get all tracked event mappings
- **DELETE /google/tracked-events**: Clear all event mappings
- **DELETE /google/tracked-events/:erCode**: Remove mapping for a specific ER code

### Alchemy Integration

- **PUT /alchemy/update-alchemy**: Update Alchemy with Google Calendar event data

### System

- **GET /status**: Get API status and configuration

## Usage Examples

### Creating/Updating a Google Calendar Event

```bash
curl -X POST "https://your-server/google/create-event" \
  -H "Content-Type: application/json" \
  -d '{
    "calendarId": "your_calendar_id",
    "summary": "ER15 - HPLC",
    "location": "Manufacturing Plant",
    "description": "Water Soluble test RecordID: 50982",
    "StartUse": "Feb 27 2025 07:00 PM",
    "EndUse": "Feb 27 2025 08:00 PM",
    "timeZone": "America/New_York"
  }'
```

## Deployment

### Deploying to Render

1. Create a new Web Service in Render
2. Connect to your GitHub repository
3. Set the required environment variables
4. Deploy the service

## Troubleshooting

- **Duplicate Events**: Clear event tracking with `/google/tracked-events` (DELETE)
- **Event Not Updating**: Make sure the ER code (e.g., "ER15") is at the beginning of the summary
- **API Errors**: Check the logs for detailed error messages
