import express from "express";
import fetch from "node-fetch";
import { DateTime } from "luxon";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

const router = express.Router();

// Simplified event tracking
let eventMappings = {};

// Try to load existing mappings if available
const TRACKING_FILE = '/tmp/er_events.json';
try {
    if (fs.existsSync(TRACKING_FILE)) {
        const fileContent = fs.readFileSync(TRACKING_FILE, 'utf8');
        eventMappings = JSON.parse(fileContent);
        console.log(`📂 Loaded ${Object.keys(eventMappings).length} ER code mappings`);
    }
} catch (error) {
    console.error(`⚠️ Error loading tracking file: ${error.message}`);
}

// Save mappings periodically
function saveMappings() {
    try {
        fs.writeFileSync(TRACKING_FILE, JSON.stringify(eventMappings, null, 2), 'utf8');
        console.log(`📂 Saved ${Object.keys(eventMappings).length} ER code mappings`);
    } catch (error) {
        console.error(`⚠️ Error saving tracking file: ${error.message}`);
    }
}

// Extract ER code from summary
function extractERCode(summary) {
    if (!summary) return null;
    
    const match = summary.match(/^(ER\d+)/);
    if (match && match[1]) {
        console.log(`✅ Found ER code: ${match[1]}`);
        return match[1];
    }
    
    return null;
}

// ✅ Function to Convert Alchemy Date to ISO Format
function convertAlchemyDate(dateString, timeZone) {
    try {
        if (!dateString) return null;
        
        // Handle different Alchemy date formats
        let date;
        
        // Try different formats in order of likelihood
        const formats = [
            "MMM dd yyyy hh:mm a",   // Feb 28 2025 02:00 PM
            "yyyy-MM-dd'T'HH:mm:ss'Z'", // 2025-02-28T14:00:00Z
            "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", // 2025-02-28T14:00:00.000Z
        ];
        
        // Try each format until one works
        for (let format of formats) {
            date = DateTime.fromFormat(dateString, format, { zone: "UTC" });
            if (date.isValid) break;
        }
        
        // If none of the formats worked, try ISO parsing as a fallback
        if (!date || !date.isValid) {
            date = DateTime.fromISO(dateString, { zone: "UTC" });
        }

        if (!date.isValid) {
            return null;
        }
        
        return date.setZone(timeZone).toISO();
    } catch (error) {
        console.error("❌ Date conversion error:", error.message);
        // Return the original string if it looks like an ISO date already
        if (dateString.includes('T') && (dateString.includes('Z') || dateString.includes('+'))) {
            return dateString;
        }
        return null;
    }
}

// ✅ Function to Refresh Google API Access Token
async function getGoogleAccessToken() {
    try {
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
        
        return data.access_token;
    } catch (error) {
        console.error("❌ Error refreshing Google access token:", error.message);
        return null;
    }
}

// Create a new event in Google Calendar
async function createNewEvent(accessToken, calendarId, eventBody, erCode) {
    console.log(`➕ Creating new event ${erCode ? `for ER code ${erCode}` : ''}`);
    
    const response = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`,
        {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${accessToken}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(eventBody)
        }
    );
    
    const data = await response.json();
    
    if (!response.ok) {
        throw new Error(`Google Calendar Error: ${JSON.stringify(data)}`);
    }
    
    // If we have an ER code, save the mapping
    if (erCode) {
        eventMappings[erCode] = data.id;
        saveMappings();
    }
    
    console.log(`✅ Successfully created new event: ${data.id}`);
    return data;
}

// Route to create or update event
router.post("/create-event", async (req, res) => {
    console.log("📩 Request received:", JSON.stringify(req.body, null, 2));
    
    try {
        // Extract basic event details
        const summary = req.body.summary || "";
        const description = req.body.description || "";
        const location = req.body.location || "";
        const calendarId = req.body.calendarId || "primary";
        const timeZone = req.body.timeZone || "America/New_York";
        
        // Get dates
        let startTime, endTime;
        
        if (req.body.start && req.body.start.dateTime) {
            startTime = req.body.start.dateTime;
        } else if (req.body.StartUse) {
            startTime = req.body.StartUse;
        }
        
        if (req.body.end && req.body.end.dateTime) {
            endTime = req.body.end.dateTime;
        } else if (req.body.EndUse) {
            endTime = req.body.EndUse;
        }
        
        if (!startTime || !endTime) {
            return res.status(400).json({ error: "Missing start or end time" });
        }
        
        // CRITICAL: Extract ER code from summary
        const erCode = extractERCode(summary);
        if (!erCode) {
            console.log("⚠️ No ER code found in summary, creating as new event");
        } else {
            console.log(`🔍 Looking for existing event with ER code: ${erCode}`);
        }
        
        // Get access token
        const accessToken = await getGoogleAccessToken();
        if (!accessToken) {
            return res.status(500).json({ error: "Failed to obtain Google access token" });
        }
        
        // Convert dates
        const startISO = convertAlchemyDate(startTime, timeZone);
        const endISO = convertAlchemyDate(endTime, timeZone);
        
        if (!startISO || !endISO) {
            return res.status(400).json({ error: "Invalid date format" });
        }
        
        // Create event object
        const eventBody = {
            summary: summary,
            description: description,
            location: location,
            start: { dateTime: startISO, timeZone },
            end: { dateTime: endISO, timeZone },
            reminders: req.body.reminders || { useDefault: true }
        };
        
        // Check if we have an existing event with this ER code
        if (erCode && eventMappings[erCode]) {
            // Try to update existing event
            const eventId = eventMappings[erCode];
            console.log(`🔄 Attempting to update existing event ${eventId} for ER code ${erCode}`);
            
            try {
                const response = await fetch(
                    `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${eventId}`,
                    {
                        method: "PATCH",
                        headers: {
                            "Authorization": `Bearer ${accessToken}`,
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify(eventBody)
                    }
                );
                
                // If event was deleted (404), create a new one
                if (response.status === 404) {
                    console.log(`🔶 Event ${eventId} not found (was deleted). Creating new event...`);
                    // Remove old mapping
                    delete eventMappings[erCode];
                    
                    // Create new event
                    const newEventData = await createNewEvent(accessToken, calendarId, eventBody, erCode);
                    
                    return res.status(200).json({
                        success: true,
                        action: "recreated",
                        event: newEventData,
                        erCode: erCode
                    });
                }
                
                // If update succeeded
                if (response.ok) {
                    const data = await response.json();
                    console.log(`✅ Successfully updated event: ${eventId}`);
                    
                    return res.status(200).json({
                        success: true,
                        action: "updated",
                        event: data,
                        erCode: erCode
                    });
                } else {
                    // Some other error
                    const errorData = await response.json();
                    console.error(`❌ Error updating event: ${JSON.stringify(errorData)}`);
                    throw new Error(`Google Calendar Update Error: ${JSON.stringify(errorData)}`);
                }
            } catch (error) {
                if (error.message.includes('404')) {
                    // Handle the case where the event was deleted
                    console.log(`🔶 Error indicates event ${eventId} was deleted. Creating new event...`);
                    delete eventMappings[erCode];
                    
                    // Create new event
                    const newEventData = await createNewEvent(accessToken, calendarId, eventBody, erCode);
                    
                    return res.status(200).json({
                        success: true,
                        action: "recreated",
                        event: newEventData,
                        erCode: erCode
                    });
                } else {
                    // Re-throw other errors
                    throw error;
                }
            }
        }
        
        // Create new event for cases where:
        // 1. No ER code was found
        // 2. No existing mapping for this ER code
        const data = await createNewEvent(accessToken, calendarId, eventBody, erCode);
        
        return res.status(200).json({
            success: true,
            action: "created",
            event: data,
            erCode: erCode
        });
    } catch (error) {
        console.error(`❌ Error: ${error.message}`);
        return res.status(500).json({ error: error.message });
    }
});

// Route to get tracked events
router.get("/tracked-events", (req, res) => {
    return res.status(200).json(eventMappings);
});

// Route to clear tracked events
router.delete("/tracked-events", (req, res) => {
    eventMappings = {};
    saveMappings();
    
    return res.status(200).json({
        success: true,
        message: "Cleared all event mappings"
    });
});

// Manually remove a specific ER code mapping
router.delete("/tracked-events/:erCode", (req, res) => {
    const erCode = req.params.erCode;
    
    if (eventMappings[erCode]) {
        const eventId = eventMappings[erCode];
        delete eventMappings[erCode];
        saveMappings();
        
        return res.status(200).json({
            success: true,
            message: `Removed mapping for ER code ${erCode} (event ID: ${eventId})`
        });
    } else {
        return res.status(404).json({
            success: false,
            message: `No mapping found for ER code ${erCode}`
        });
    }
});

export default router;
