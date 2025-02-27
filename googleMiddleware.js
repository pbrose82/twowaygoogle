import express from "express";
import fetch from "node-fetch";
import { DateTime } from "luxon";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

const router = express.Router();

// Global in-memory tracking (persists during runtime)
const eventMappings = {};

// Custom file paths for maximum compatibility
const TRACKING_FILE = process.env.EVENT_TRACKING_FILE || '/tmp/er_events.json';
console.log(`Using tracking file at: ${TRACKING_FILE}`);

// Load previously saved mappings
function loadMappings() {
    console.log(`Attempting to load tracking data from: ${TRACKING_FILE}`);
    try {
        if (fs.existsSync(TRACKING_FILE)) {
            const data = fs.readFileSync(TRACKING_FILE, 'utf8');
            console.log(`Read tracking file contents: ${data.substring(0, 100)}${data.length > 100 ? '...' : ''}`);
            
            const parsed = JSON.parse(data);
            const count = Object.keys(parsed).length;
            
            // Update our in-memory mappings
            Object.assign(eventMappings, parsed);
            
            console.log(`✅ Loaded ${count} event mappings`);
            console.log(`Current mappings: ${JSON.stringify(eventMappings)}`);
            return true;
        } else {
            console.log(`Tracking file does not exist yet`);
            return false;
        }
    } catch (error) {
        console.error(`❌ Error loading mappings: ${error.message}`);
        return false;
    }
}

// Save mappings to disk
function saveMappings() {
    try {
        console.log(`Saving mappings: ${JSON.stringify(eventMappings)}`);
        fs.writeFileSync(TRACKING_FILE, JSON.stringify(eventMappings, null, 2), 'utf8');
        console.log(`✅ Saved ${Object.keys(eventMappings).length} mappings to ${TRACKING_FILE}`);
        
        // Verify we can read what we wrote
        if (fs.existsSync(TRACKING_FILE)) {
            const content = fs.readFileSync(TRACKING_FILE, 'utf8');
            console.log(`✅ Verified tracking file content: ${content.substring(0, 100)}${content.length > 100 ? '...' : ''}`);
        }
        return true;
    } catch (error) {
        console.error(`❌ Error saving mappings: ${error.message}`);
        return false;
    }
}

// Extract ER code from summary (for unique tracking)
function extractERCode(summary) {
    if (!summary) return null;
    
    const match = summary.match(/^(ER\d+)/);
    if (match && match[1]) {
        const erCode = match[1];
        console.log(`✅ Found ER code: ${erCode}`);
        return erCode;
    }
    
    return null;
}

// Convert date formats
function convertAlchemyDate(dateString, timeZone) {
    try {
        if (!dateString) return null;
        
        // Try different formats
        let date;
        const formats = [
            "MMM dd yyyy hh:mm a",   // Feb 28 2025 02:00 PM
            "yyyy-MM-dd'T'HH:mm:ss'Z'", // 2025-02-28T14:00:00Z
            "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", // 2025-02-28T14:00:00.000Z
        ];
        
        for (let format of formats) {
            date = DateTime.fromFormat(dateString, format, { zone: "UTC" });
            if (date.isValid) break;
        }
        
        if (!date || !date.isValid) {
            date = DateTime.fromISO(dateString, { zone: "UTC" });
        }

        if (!date.isValid) {
            return null;
        }
        
        return date.setZone(timeZone).toISO();
    } catch (error) {
        console.error(`❌ Date conversion error: ${error.message}`);
        
        if (dateString.includes('T') && (dateString.includes('Z') || dateString.includes('+'))) {
            return dateString;
        }
        return null;
    }
}

// Get Google access token
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
        console.error(`❌ Error getting Google token: ${error.message}`);
        return null;
    }
}

// Ensure we have our mappings loaded
loadMappings();

// Create a new Google Calendar event
async function createEvent(accessToken, calendarId, eventBody, erCode) {
    try {
        console.log(`Creating new event for ER code: ${erCode}`);
        
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
            console.error(`Error response: ${JSON.stringify(data)}`);
            throw new Error(`Google Calendar Error: ${data.error?.message || JSON.stringify(data)}`);
        }
        
        // Store the mapping of ER code to event ID
        console.log(`Recording mapping: ${erCode} -> ${data.id}`);
        eventMappings[erCode] = data.id;
        saveMappings();
        
        return data;
    } catch (error) {
        console.error(`Error creating event: ${error.message}`);
        throw error;
    }
}

// Update an existing Google Calendar event
async function updateEvent(accessToken, calendarId, eventId, eventBody) {
    try {
        console.log(`Updating event: ${eventId}`);
        
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
        
        // Handle 404 (event was deleted)
        if (response.status === 404) {
            console.log(`Event ${eventId} not found (likely deleted)`);
            return null;
        }
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(`Google Calendar Error: ${data.error?.message || JSON.stringify(data)}`);
        }
        
        return data;
    } catch (error) {
        console.error(`Error updating event: ${error.message}`);
        throw error;
    }
}

// Create or update event route
router.post("/create-event", async (req, res) => {
    console.log("📩 Request received:", JSON.stringify(req.body, null, 2));
    console.log("Current event mappings:", JSON.stringify(eventMappings));
    
    // Refresh our event mappings just in case
    loadMappings();
    
    try {
        // Get basic event details
        const summary = req.body.summary || "";
        const description = req.body.description || "";
        const location = req.body.location || "";
        const calendarId = req.body.calendarId || "primary";
        const timeZone = req.body.timeZone || "America/New_York";
        
        // Get start and end times
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
        
        // Extract ER code from summary
        const erCode = extractERCode(summary);
        if (!erCode) {
            console.log("No ER code found in summary");
            return res.status(400).json({ error: "No ER code found in summary" });
        }
        
        // Convert times to ISO format
        const startISO = convertAlchemyDate(startTime, timeZone);
        const endISO = convertAlchemyDate(endTime, timeZone);
        
        if (!startISO || !endISO) {
            return res.status(400).json({ error: "Invalid date format" });
        }
        
        // Prepare event data
        const eventBody = {
            summary: summary,
            description: description,
            location: location,
            start: { dateTime: startISO, timeZone },
            end: { dateTime: endISO, timeZone },
            reminders: req.body.reminders || { useDefault: true }
        };
        
        // Get Google access token
        const accessToken = await getGoogleAccessToken();
        if (!accessToken) {
            return res.status(500).json({ error: "Failed to obtain Google access token" });
        }
        
        // Check if we have a mapping for this ER code
        const existingEventId = eventMappings[erCode];
        console.log(`Looking for existing event with ER code ${erCode}: ${existingEventId || 'not found'}`);
        
        let result;
        
        if (existingEventId) {
            // Try to update the existing event
            result = await updateEvent(accessToken, calendarId, existingEventId, eventBody);
            
            // If event was deleted, create a new one
            if (!result) {
                console.log(`Event ${existingEventId} was deleted, creating new one`);
                delete eventMappings[erCode];
                saveMappings();
                
                result = await createEvent(accessToken, calendarId, eventBody, erCode);
                
                return res.status(200).json({
                    success: true,
                    action: "recreated",
                    event: result,
                    erCode: erCode
                });
            }
            
            console.log(`Successfully updated event: ${existingEventId}`);
            return res.status(200).json({
                success: true,
                action: "updated",
                event: result,
                erCode: erCode
            });
        } else {
            // Create a new event
            result = await createEvent(accessToken, calendarId, eventBody, erCode);
            
            console.log(`Successfully created new event: ${result.id}`);
            return res.status(200).json({
                success: true,
                action: "created",
                event: result,
                erCode: erCode
            });
        }
    } catch (error) {
        console.error(`Error: ${error.message}`);
        return res.status(500).json({ error: error.message });
    }
});

// Get all tracked events
router.get("/tracked-events", (req, res) => {
    // Refresh our knowledge of tracked events
    loadMappings();
    
    return res.status(200).json({
        mappings: eventMappings,
        count: Object.keys(eventMappings).length,
        trackingFile: TRACKING_FILE
    });
});

// Clear all tracked events
router.delete("/tracked-events", (req, res) => {
    // Clear the in-memory mappings
    Object.keys(eventMappings).forEach(key => {
        delete eventMappings[key];
    });
    
    // Save the empty mappings
    saveMappings();
    
    return res.status(200).json({
        success: true,
        message: "All event mappings cleared"
    });
});

// Manual management of tracked events
router.delete("/tracked-events/:erCode", (req, res) => {
    const erCode = req.params.erCode;
    
    if (eventMappings[erCode]) {
        const eventId = eventMappings[erCode];
        delete eventMappings[erCode];
        saveMappings();
        
        return res.status(200).json({
            success: true,
            message: `Removed mapping for ${erCode}`,
            removedEventId: eventId
        });
    }
    
    return res.status(404).json({
        success: false,
        message: `No mapping found for ${erCode}`
    });
});

export default router;
