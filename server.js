import express from "express";
import fetch from "node-fetch";
import { DateTime } from "luxon";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

const router = express.Router();

// Enhanced debugging
const DEBUG = true;

function debug(...args) {
    if (DEBUG) {
        console.log("🔍 DEBUG:", ...args);
    }
}

// Persistent event tracking using a simple JSON file
const EVENT_TRACKING_FILE = process.env.EVENT_TRACKING_FILE || './event_tracking.json';

// Load existing event tracking data
let eventTrackingData = {};
try {
    if (fs.existsSync(EVENT_TRACKING_FILE)) {
        const fileContent = fs.readFileSync(EVENT_TRACKING_FILE, 'utf8');
        eventTrackingData = JSON.parse(fileContent);
        console.log(`📂 Loaded ${Object.keys(eventTrackingData).length} event mappings from tracking file`);
    } else {
        console.log(`📂 No event tracking file found at ${EVENT_TRACKING_FILE}, will create a new one`);
        fs.writeFileSync(EVENT_TRACKING_FILE, JSON.stringify({}), 'utf8');
    }
} catch (error) {
    console.error(`⚠️ Error with event tracking file: ${error.message}`);
    // Continue with empty tracking data
    eventTrackingData = {};
}

// Function to save event tracking data
function saveEventTracking() {
    try {
        fs.writeFileSync(EVENT_TRACKING_FILE, JSON.stringify(eventTrackingData, null, 2), 'utf8');
        console.log(`✅ Saved ${Object.keys(eventTrackingData).length} event mappings to tracking file`);
    } catch (error) {
        console.error(`⚠️ Error saving event tracking file: ${error.message}`);
    }
}

// Function to extract RecordID from description
function extractRecordIdFromDescription(description) {
    debug("Attempting to extract RecordID from description:", description);
    
    if (!description) {
        debug("Description is empty or undefined");
        return null;
    }
    
    // Try to extract "RecordID: XXXXX" pattern
    const recordIdMatch = description.match(/RecordID:\s*(\d+)/i);
    if (recordIdMatch && recordIdMatch[1]) {
        debug(`Successfully extracted RecordID ${recordIdMatch[1]} from description`);
        return recordIdMatch[1];
    }
    
    debug("No RecordID pattern found in description");
    return null;
}

// ✅ Function to Convert Alchemy Date to ISO Format
function convertAlchemyDate(dateString, timeZone) {
    try {
        console.log(`🔄 Converting date: "${dateString}" with timezone: ${timeZone}`);
        
        if (!dateString) {
            throw new Error("Date string is empty or undefined");
        }
        
        // Handle different Alchemy date formats
        let date;
        
        // Try different formats in order of likelihood
        const formats = [
            "MMM dd yyyy hh:mm a",   // Feb 28 2025 02:00 PM
            "yyyy-MM-dd'T'HH:mm:ss'Z'", // 2025-02-28T14:00:00Z
            "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", // 2025-02-28T14:00:00.000Z
            "yyyy-MM-dd HH:mm:ss",    // 2025-02-28 14:00:00
            "M/d/yyyy HH:mm:ss",      // 2/28/2025 14:00:00
            "M/d/yyyy h:mm a"         // 2/28/2025 2:00 PM
        ];
        
        // Try each format until one works
        for (let format of formats) {
            date = DateTime.fromFormat(dateString, format, { zone: "UTC" });
            if (date.isValid) {
                console.log(`✅ Date parsed with format: ${format}`);
                break;
            }
        }
        
        // If none of the formats worked, try ISO parsing as a fallback
        if (!date || !date.isValid) {
            date = DateTime.fromISO(dateString, { zone: "UTC" });
            console.log(`⚠️ Attempting ISO parsing fallback: ${date.isValid ? 'successful' : 'failed'}`);
        }

        if (!date.isValid) {
            throw new Error(`Invalid date format received: ${dateString}`);
        }
        
        const result = date.setZone(timeZone).toISO();
        console.log(`✅ Converted date result: ${result}`);
        return result;
    } catch (error) {
        console.error("❌ Date conversion error:", error.message);
        // Return the original string if it looks like an ISO date already
        if (dateString && dateString.includes('T') && 
            (dateString.includes('Z') || dateString.includes('+'))) {
            console.log("⚠️ Returning original string as it appears to be ISO format already");
            return dateString;
        }
        return null;
    }
}

// ✅ Function to Refresh Google API Access Token
async function getGoogleAccessToken() {
    try {
        console.log("🔄 Refreshing Google Access Token...");
        
        const response = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                client_id: process.env.GOOGLE_CLIENT_ID,
                client_secret: process.env.GOOGLE_CLIENT_SECRET,
                refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
                grant_type: "refresh_token"
            })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(`Google Token Error: ${JSON.stringify(data)}`);
        }
        
        console.log("✅ Google Access Token refreshed successfully");
        return data.access_token;
    } catch (error) {
        console.error("❌ Error refreshing Google access token:", error.message);
        return null;
    }
}

// Track recent events (5 minute window)
const recentEvents = new Map();
const RECENT_EVENT_EXPIRY = 5 * 60 * 1000; // 5 minutes

function addRecentEvent(recordId, eventId) {
    recentEvents.set(recordId, {
        eventId,
        timestamp: Date.now()
    });
    
    // Cleanup old entries
    for (let [key, value] of recentEvents.entries()) {
        if (Date.now() - value.timestamp > RECENT_EVENT_EXPIRY) {
            recentEvents.delete(key);
        }
    }
}

function getRecentEvent(recordId) {
    const entry = recentEvents.get(recordId);
    if (entry && (Date.now() - entry.timestamp <= RECENT_EVENT_EXPIRY)) {
        return entry.eventId;
    }
    return null;
}

// Direct API functions
async function createGoogleEvent(accessToken, calendarId, eventData, recordId) {
    try {
        console.log(`➕ Creating new Google Calendar event for record ID: ${recordId}`);
        
        const response = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`,
            {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${accessToken}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(eventData)
            }
        );
        
        const responseText = await response.text();
        console.log(`🔍 Google API Response Status: ${response.status}`);
        console.log(`🔍 Google API Raw Response: ${responseText.substring(0, 500)}`);
        
        let data;
        try {
            data = JSON.parse(responseText);
        } catch (e) {
            console.error("❌ Error parsing response JSON:", e);
            throw new Error(`Invalid response from Google API: ${responseText.substring(0, 100)}`);
        }
        
        if (!response.ok) {
            throw new Error(`Google Calendar Error: ${JSON.stringify(data)}`);
        }
        
        // Save the mapping of recordId to eventId
        if (recordId && data.id) {
            eventTrackingData[recordId] = data.id;
            saveEventTracking();
            addRecentEvent(recordId, data.id);
        }
        
        return data;
    } catch (error) {
        console.error(`❌ Error creating Google event: ${error.message}`);
        throw error;
    }
}

async function updateGoogleEvent(accessToken, calendarId, eventId, eventData) {
    try {
        console.log(`🔄 Updating Google Calendar event: ${eventId}`);
        
        const response = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${eventId}`,
            {
                method: "PATCH",
                headers: {
                    "Authorization": `Bearer ${accessToken}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(eventData)
            }
        );
        
        const responseText = await response.text();
        console.log(`🔍 Google API Response Status: ${response.status}`);
        console.log(`🔍 Google API Raw Response: ${responseText.substring(0, 500)}`);
        
        // If the event was not found (404), it might have been deleted
        if (response.status === 404) {
            console.log(`⚠️ Event ${eventId} not found, it might have been deleted`);
            return null;
        }
        
        let data;
        try {
            data = JSON.parse(responseText);
        } catch (e) {
            console.error("❌ Error parsing response JSON:", e);
            throw new Error(`Invalid response from Google API: ${responseText.substring(0, 100)}`);
        }
        
        if (!response.ok) {
            throw new Error(`Google Calendar Update Error: ${JSON.stringify(data)}`);
        }
        
        return data;
    } catch (error) {
        console.error(`❌ Error updating Google event: ${error.message}`);
        throw error;
    }
}

// ✅ Route to Create or Update a Google Calendar Event
router.post("/create-event", async (req, res) => {
    console.log("📩 Alchemy request received for Google Calendar:", JSON.stringify(req.body, null, 2));
    
    // Parse request data, supporting multiple formats
    let recordId, summary, description, location, startTime, endTime, timeZone, calendarId;
    
    try {
        // Support various request formats for recordId
        recordId = req.body.recordId || req.body.id || req.body.record_id;
        debug("Initial recordId from request properties:", recordId);
        
        calendarId = req.body.calendarId || req.body.calendar_id || req.body.calendar || 'primary';
        timeZone = req.body.timeZone || req.body.timezone || req.body.time_zone || "America/New_York";
        
        // Handle summary/title
        summary = req.body.summary || req.body.title || req.body.event_name || "Default Event Name";
        
        // Handle description/notes
        description = req.body.description || req.body.notes || req.body.details || "No Description";
        debug("Description from request:", description);
        
        // CRITICAL: Try to extract recordId from description if not explicitly provided
        if (!recordId) {
            debug("No recordId found in request properties, attempting to extract from description");
            const extractedId = extractRecordIdFromDescription(description);
            if (extractedId) {
                recordId = extractedId;
                console.log(`✅ FOUND RECORDID IN DESCRIPTION: ${recordId}`);
            } else {
                console.log("❌ Failed to extract RecordID from description");
            }
        }
        
        // Ensure the RecordID is in the description for future reference
        if (recordId && !description.includes(`RecordID: ${recordId}`)) {
            description = `${description} RecordID: ${recordId}`;
            debug("Updated description with RecordID:", description);
        }
        
        // Handle location
        location = req.body.location || req.body.place || req.body.venue || "No Location Provided";
        
        // Handle start time - check various formats
        if (req.body.start && req.body.start.dateTime) {
            // Google Calendar format with start.dateTime
            startTime = req.body.start.dateTime;
        } else if (req.body.StartUse) {
            // Current Alchemy format
            startTime = req.body.StartUse;
        } else if (req.body.start_time) {
            // Alternate key name
            startTime = req.body.start_time;
        } else if (req.body.startTime) {
            // Camel case variation
            startTime = req.body.startTime;
        } else if (req.body.start) {
            // Simple key
            startTime = req.body.start;
        }
        
        // Handle end time - check various formats
        if (req.body.end && req.body.end.dateTime) {
            // Google Calendar format with end.dateTime
            endTime = req.body.end.dateTime;
        } else if (req.body.EndUse) {
            // Current Alchemy format
            endTime = req.body.EndUse;
        } else if (req.body.end_time) {
            // Alternate key name
            endTime = req.body.end_time;
        } else if (req.body.endTime) {
            // Camel case variation
            endTime = req.body.endTime;
        } else if (req.body.end) {
            // Simple key
            endTime = req.body.end;
        }
        
        // Last resort - try to find any numeric pattern that could be a RecordID
        if (!recordId) {
            debug("Still no recordId found, searching entire request body for potential IDs");
            const jsonStr = JSON.stringify(req.body);
            const allNumbers = jsonStr.match(/\d+/g) || [];
            const potentialIds = allNumbers.filter(num => num.length >= 4 && num.length <= 8);
            
            if (potentialIds.length > 0) {
                console.log(`⚠️ Potential RecordIDs found in request body: ${potentialIds.join(', ')}`);
                // Use the first one (risky but better than a random ID)
                recordId = potentialIds[0];
                console.log(`⚠️ Using potential RecordID: ${recordId}`);
            } else {
                console.log("❌ No potential RecordIDs found in request body");
            }
        }
        
        if (!recordId) {
            console.warn("⚠️ No recordId found in request, generating a placeholder ID");
            // Generate a random ID if none provided
            recordId = `alchemyEvent_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        }
        
        if (!startTime || !endTime) {
            throw new Error("Missing required start or end time");
        }
        
        console.log(`📋 Parsed request data:
            - Record ID: ${recordId}
            - Calendar ID: ${calendarId}
            - Summary: ${summary}
            - Start: ${startTime}
            - End: ${endTime}
            - Time Zone: ${timeZone}`);
    } catch (error) {
        console.error("❌ Error parsing request:", error.message);
        return res.status(400).json({ 
            error: "Invalid request format", 
            message: error.message,
            required: "Please provide recordId, start and end times"
        });
    }
    
    const accessToken = await getGoogleAccessToken();
    if (!accessToken) {
        return res.status(500).json({ error: "Failed to obtain Google access token" });
    }
    
    try {
        // Convert date strings to ISO format
        const startISO = convertAlchemyDate(startTime, timeZone);
        const endISO = convertAlchemyDate(endTime, timeZone);
        
        if (!startISO || !endISO) {
            return res.status(400).json({ 
                error: "Invalid date format", 
                message: "Could not parse start or end time",
                received: { start: startTime, end: endTime },
                supported: "Formats like 'Feb 28 2025 02:00 PM' or ISO strings"
            });
        }
        
        // Prepare the event data
        const eventBody = {
            summary: summary,
            description: description,
            location: location,
            start: { dateTime: startISO, timeZone },
            end: { dateTime: endISO, timeZone },
            reminders: req.body.reminders || { useDefault: true },
            // Add extended properties to store Alchemy record ID
            extendedProperties: {
                private: {
                    alchemyRecordId: recordId
                }
            }
        };
        
        // CRITICAL: Check for duplicates using tracking mechanisms
        
        // First check recently created events (in-memory, short term)
        let recentEventId = getRecentEvent(recordId);
        if (recentEventId) {
            console.log(`⚠️ DUPLICATE PREVENTION: Found recently created event for recordId ${recordId}: ${recentEventId}`);
        }
        
        // Then check persistent tracking (file-based, long term)
        let trackedEventId = eventTrackingData[recordId];
        if (trackedEventId) {
            console.log(`⚠️ DUPLICATE PREVENTION: Found tracked event for recordId ${recordId}: ${trackedEventId}`);
        }
        
        // Use the most reliable ID available
        let existingEventId = recentEventId || trackedEventId;
        
        let result;
        
        if (existingEventId) {
            // Try to update the existing event
            try {
                result = await updateGoogleEvent(accessToken, calendarId, existingEventId, eventBody);
                
                // If update succeeded
                if (result) {
                    console.log(`✅ Successfully updated event: ${existingEventId}`);
                    
                    // Make sure the tracking is up to date
                    eventTrackingData[recordId] = existingEventId;
                    saveEventTracking();
                    addRecentEvent(recordId, existingEventId);
                    
                    return res.status(200).json({
                        success: true,
                        action: "updated",
                        event: result,
                        recordId: recordId,
                        eventId: existingEventId
                    });
                } else {
                    // Update failed, event might have been deleted
                    console.log(`⚠️ Failed to update event ${existingEventId}, will create a new one`);
                    // Continue to create a new event
                }
            } catch (error) {
                console.error(`⚠️ Error updating event ${existingEventId}: ${error.message}`);
                // Continue to create a new event
            }
        }
        
        // Either no existing event was found or update failed - create a new one
        result = await createGoogleEvent(accessToken, calendarId, eventBody, recordId);
        
        console.log(`✅ Successfully created new event: ${result.id}`);
        
        return res.status(200).json({
            success: true,
            action: "created",
            event: result,
            recordId: recordId,
            eventId: result.id
        });
    } catch (error) {
        console.error(`❌ Error processing calendar event: ${error.message}`);
        return res.status(500).json({ 
            error: "Failed to process calendar event", 
            details: error.message
        });
    }
});

// Route to get all tracked events (for debugging)
router.get("/tracked-events", (req, res) => {
    return res.status(200).json({
        trackedEvents: eventTrackingData,
        recentEvents: Array.from(recentEvents.entries()).map(([key, value]) => ({
            recordId: key,
            eventId: value.eventId,
            timestamp: new Date(value.timestamp).toISOString()
        }))
    });
});

// Route to clear tracked events (for debugging/reset)
router.delete("/tracked-events", (req, res) => {
    eventTrackingData = {};
    saveEventTracking();
    recentEvents.clear();
    
    return res.status(200).json({
        success: true,
        message: "All event tracking data has been cleared"
    });
});

// Route for direct control - create event
router.post("/force-create/:recordId", async (req, res) => {
    const recordId = req.params.recordId;
    console.log(`📋 Direct creation for recordId: ${recordId}`);
    
    if (!recordId) {
        return res.status(400).json({ error: "Missing recordId parameter" });
    }
    
    // Forward to normal create with recordId explicitly set
    req.body.recordId = recordId;
    return router.handle(req, res, {
        method: 'POST',
        url: '/create-event'
    });
});

export default router;
