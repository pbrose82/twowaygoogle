import express from "express";
import fetch from "node-fetch";
import { DateTime } from "luxon";
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();

// In-memory cache for event mappings (recordId -> eventId)
// This helps even if extended properties don't work
const eventCache = new Map();

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

// 🔄 Enhanced function to Find Existing Google Calendar Event by Alchemy Record ID
// Now with multiple strategies to find matching events
async function findExistingEvent(accessToken, calendarId, recordId, summary = null, startTime = null) {
    try {
        console.log(`🔍 Looking for existing event with Alchemy record ID: ${recordId}`);
        
        // STRATEGY 1: Check in-memory cache first (fastest)
        if (eventCache.has(recordId)) {
            const cachedEventId = eventCache.get(recordId);
            console.log(`✅ Found event in cache: ${cachedEventId}`);
            
            // Verify this event still exists
            try {
                const verifyResponse = await fetch(
                    `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${cachedEventId}`,
                    {
                        method: "GET",
                        headers: { "Authorization": `Bearer ${accessToken}` }
                    }
                );
                
                if (verifyResponse.ok) {
                    return cachedEventId;
                } else {
                    console.log(`⚠️ Cached event ${cachedEventId} no longer exists, removing from cache`);
                    eventCache.delete(recordId);
                }
            } catch (error) {
                console.error(`⚠️ Error verifying cached event: ${error.message}`);
                // Continue to other strategies
            }
        }
        
        // STRATEGY 2: Search by extended properties (most reliable if set correctly)
        try {
            const queryParams = new URLSearchParams({
                privateExtendedProperty: `alchemyRecordId=${recordId}`
            }).toString();
            
            const response = await fetch(
                `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?${queryParams}`, 
                {
                    method: "GET",
                    headers: { "Authorization": `Bearer ${accessToken}` }
                }
            );
            
            const data = await response.json();
            
            if (response.ok && data.items && data.items.length > 0) {
                const eventId = data.items[0].id;
                console.log(`✅ Found existing event by extended property: ${eventId}`);
                eventCache.set(recordId, eventId); // Update cache
                return eventId;
            }
        } catch (error) {
            console.error(`⚠️ Error searching by extended property: ${error.message}`);
            // Continue to other strategies
        }
        
        // STRATEGY 3: Search by exact title and description containing recordID (backup method)
        if (summary) {
            try {
                // Search for events with the exact same title
                const response = await fetch(
                    `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?q=${encodeURIComponent(summary)}`, 
                    {
                        method: "GET",
                        headers: { "Authorization": `Bearer ${accessToken}` }
                    }
                );
                
                const data = await response.json();
                
                if (response.ok && data.items && data.items.length > 0) {
                    // Look for an event with matching RecordID in description or summary
                    const recordIdString = `RecordID: ${recordId}`;
                    const matchingEvent = data.items.find(event => 
                        (event.description && event.description.includes(recordIdString)) ||
                        (event.summary && event.summary.includes(recordIdString))
                    );
                    
                    if (matchingEvent) {
                        console.log(`✅ Found existing event by title/description match: ${matchingEvent.id}`);
                        eventCache.set(recordId, matchingEvent.id); // Update cache
                        
                        // Update the event with extended properties for future lookups
                        try {
                            await fetch(
                                `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${matchingEvent.id}`, 
                                {
                                    method: "PATCH",
                                    headers: { 
                                        "Authorization": `Bearer ${accessToken}`,
                                        "Content-Type": "application/json"
                                    },
                                    body: JSON.stringify({
                                        extendedProperties: {
                                            private: {
                                                alchemyRecordId: recordId
                                            }
                                        }
                                    })
                                }
                            );
                            console.log(`✅ Updated event ${matchingEvent.id} with extended properties`);
                        } catch (error) {
                            console.error(`⚠️ Error updating extended properties: ${error.message}`);
                        }
                        
                        return matchingEvent.id;
                    }
                }
            } catch (error) {
                console.error(`⚠️ Error searching by title: ${error.message}`);
                // Continue to last strategy
            }
        }
        
        // STRATEGY 4: Search by time window (last resort)
        if (startTime) {
            try {
                const startDateTime = new Date(startTime);
                const timeMin = new Date(startDateTime.getTime() - 5 * 60000).toISOString(); // 5 minutes before
                const timeMax = new Date(startDateTime.getTime() + 5 * 60000).toISOString(); // 5 minutes after
                
                const queryParams = new URLSearchParams({
                    timeMin,
                    timeMax,
                    singleEvents: 'true'
                }).toString();
                
                const response = await fetch(
                    `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?${queryParams}`, 
                    {
                        method: "GET",
                        headers: { "Authorization": `Bearer ${accessToken}` }
                    }
                );
                
                const data = await response.json();
                
                if (response.ok && data.items && data.items.length > 0) {
                    // Look for matching summary or description containing recordID
                    const recordIdString = `RecordID: ${recordId}`;
                    const matchingEvent = data.items.find(event => 
                        (event.summary && event.summary === summary) ||
                        (event.description && event.description.includes(recordIdString))
                    );
                    
                    if (matchingEvent) {
                        console.log(`✅ Found existing event by time window and content match: ${matchingEvent.id}`);
                        eventCache.set(recordId, matchingEvent.id); // Update cache
                        return matchingEvent.id;
                    }
                }
            } catch (error) {
                console.error(`⚠️ Error searching by time window: ${error.message}`);
            }
        }
        
        console.log(`⚠️ No existing event found for Alchemy record: ${recordId}`);
        return null;
    } catch (error) {
        console.error(`❌ Error finding existing event: ${error.message}`);
        return null;
    }
}

// ✅ Route to Create or Update a Google Calendar Event
router.post("/create-event", async (req, res) => {
    console.log("📩 Alchemy request received for Google Calendar:", JSON.stringify(req.body, null, 2));
    
    // Parse request data, supporting multiple formats
    let recordId, summary, description, location, startTime, endTime, timeZone, calendarId;
    
    try {
        // Support various request formats
        recordId = req.body.recordId || req.body.id || req.body.record_id;
        calendarId = req.body.calendarId || req.body.calendar_id || req.body.calendar || 'primary';
        timeZone = req.body.timeZone || req.body.timezone || req.body.time_zone || "America/New_York";
        
        // Handle summary/title
        summary = req.body.summary || req.body.title || req.body.event_name || "Default Event Name";
        
        // Handle description/notes
        description = req.body.description || req.body.notes || req.body.details || "No Description";
        
        // Add recordId to description if not already there
        if (recordId && !description.includes(`RecordID: ${recordId}`)) {
            description = `${description} RecordID: ${recordId}`;
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
        
        if (!recordId) {
            console.warn("⚠️ No recordId found in request, generating a placeholder ID");
            // Generate a random ID if none provided
            recordId = `alchemyEvent_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
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
            reminders: { useDefault: true },
            // Add extended properties to store Alchemy record ID
            extendedProperties: {
                private: {
                    alchemyRecordId: recordId
                }
            }
        };
        
        // Check if an event already exists for this Alchemy record
        const existingEventId = await findExistingEvent(
            accessToken, 
            calendarId, 
            recordId,
            summary,
            startISO
        );
        
        let response;
        let method = "POST";
        let url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`;
        
        // If an existing event was found, use PATCH to update it
        if (existingEventId) {
            method = "PATCH";
            url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${existingEventId}`;
            console.log(`🔄 Updating existing event: ${existingEventId}`);
        } else {
            console.log(`➕ Creating new event for Alchemy record: ${recordId}`);
        }
        
        // Log the request details
        console.log(`📤 Sending Updated Payload: ${JSON.stringify(eventBody, null, 2)}`);
        
        // Send the request to Google Calendar API
        response = await fetch(url, {
            method: method,
            headers: {
                "Authorization": `Bearer ${accessToken}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(eventBody)
        });
        
        const responseText = await response.text();
        console.log(`🔍 Google API Response Status: ${response.status}`);
        console.log(`🔍 Google API Raw Response: ${responseText}`);
        
        let data;
        try {
            data = JSON.parse(responseText);
        } catch (e) {
            console.error("❌ Error parsing response JSON:", e);
            data = { text: responseText };
        }
        
        if (!response.ok) {
            throw new Error(`Google Calendar Error: ${JSON.stringify(data)}`);
        }
        
        // Store the successful event mapping in our cache
        if (data && data.id) {
            eventCache.set(recordId, data.id);
            console.log(`✅ Updated event cache: ${recordId} -> ${data.id}`);
        }
        
        const actionType = existingEventId ? "updated" : "created";
        console.log(`✅ Event successfully ${actionType} in Google Calendar:`, data.id || 'unknown');
        
        res.status(200).json({ 
            success: true, 
            action: actionType,
            event: data,
            recordId: recordId
        });
    } catch (error) {
        console.error(`❌ Error ${error.message}`);
        res.status(500).json({ 
            error: "Failed to process calendar event", 
            details: error.message
        });
    }
});

// Route handlers for update-event and delete-event remain unchanged

export default router;
