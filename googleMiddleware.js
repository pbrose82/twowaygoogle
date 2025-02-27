import express from "express";
import fetch from "node-fetch";
import { DateTime } from "luxon";
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();

// ✅ Function to Convert Alchemy Date to ISO Format
function convertAlchemyDate(dateString, timeZone) {
    try {
        let date = DateTime.fromFormat(dateString, "MMM dd yyyy hh:mm a", { zone: "UTC" });
        if (!date.isValid) {
            throw new Error(`Invalid date format received: ${dateString}`);
        }
        return date.setZone(timeZone).toISO();
    } catch (error) {
        console.error("❌ Date conversion error:", error.message);
        return null;
    }
}

// ✅ Function to Refresh Google API Access Token
async function getGoogleAccessToken() {
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
}

// 🆕 Function to Find Existing Google Calendar Event by Alchemy Record ID
async function findExistingEvent(accessToken, calendarId, recordId) {
    try {
        console.log(`🔍 Looking for existing event with Alchemy record ID: ${recordId}`);
        
        // Search for events with extended properties matching the Alchemy record ID
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
        
        if (!response.ok) {
            throw new Error(`Google Calendar Search Error: ${JSON.stringify(data)}`);
        }
        
        // Check if any matching events were found
        if (data.items && data.items.length > 0) {
            console.log(`✅ Found existing event for Alchemy record ${recordId}: ${data.items[0].id}`);
            return data.items[0].id;
        }
        
        console.log(`⚠️ No existing event found for Alchemy record: ${recordId}`);
        return null;
    } catch (error) {
        console.error(`❌ Error searching for existing event: ${error.message}`);
        return null;
    }
}

// ✅ Route to Create or Update a Google Calendar Event
router.post("/create-event", async (req, res) => {
    console.log("📩 Alchemy request received for Google Calendar:", JSON.stringify(req.body, null, 2));
    
    // Verify required parameters
    if (!req.body.recordId) {
        return res.status(400).json({ 
            error: "Missing recordId parameter", 
            message: "Please provide an Alchemy record ID to enable event updates"
        });
    }
    
    const accessToken = await getGoogleAccessToken();
    if (!accessToken) {
        return res.status(500).json({ error: "Failed to obtain Google access token" });
    }
    
    try {
        const timeZone = req.body.timeZone || "America/New_York";
        const calendarId = req.body.calendarId || "primary";
        const recordId = req.body.recordId;
        
        // Prepare the event data
        const eventBody = {
            summary: req.body.summary || "Default Event Name",
            location: req.body.location || "No Location Provided",
            description: req.body.description || "No Description",
            start: { dateTime: convertAlchemyDate(req.body.StartUse, timeZone), timeZone },
            end: { dateTime: convertAlchemyDate(req.body.EndUse, timeZone), timeZone },
            reminders: req.body.reminders || { useDefault: true },
            // Add extended properties to store Alchemy record ID
            extendedProperties: {
                private: {
                    alchemyRecordId: recordId
                }
            }
        };
        
        // Check if an event already exists for this Alchemy record
        const existingEventId = await findExistingEvent(accessToken, calendarId, recordId);
        
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
        
        // Send the request to Google Calendar API
        response = await fetch(url, {
            method: method,
            headers: {
                "Authorization": `Bearer ${accessToken}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(eventBody)
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(`Google Calendar Error: ${JSON.stringify(data)}`);
        }
        
        const actionType = existingEventId ? "updated" : "created";
        console.log(`✅ Event successfully ${actionType} in Google Calendar:`, data);
        
        res.status(200).json({ 
            success: true, 
            action: actionType,
            event: data 
        });
    } catch (error) {
        console.error(`❌ Error ${error.message}`);
        res.status(500).json({ 
            error: "Failed to process calendar event", 
            details: error.message 
        });
    }
});

// 🆕 Route to Update an Existing Google Calendar Event
router.put("/update-event", async (req, res) => {
    console.log("📩 Alchemy update request received for Google Calendar:", JSON.stringify(req.body, null, 2));
    
    if (!req.body.recordId) {
        return res.status(400).json({ error: "Missing recordId parameter" });
    }
    
    const accessToken = await getGoogleAccessToken();
    if (!accessToken) {
        return res.status(500).json({ error: "Failed to obtain Google access token" });
    }
    
    try {
        const timeZone = req.body.timeZone || "America/New_York";
        const calendarId = req.body.calendarId || "primary";
        const recordId = req.body.recordId;
        
        // Find the existing event by Alchemy record ID
        const existingEventId = await findExistingEvent(accessToken, calendarId, recordId);
        
        if (!existingEventId) {
            // If no existing event is found, redirect to the create-event endpoint
            console.log(`⚠️ No existing event found for recordId ${recordId}, creating new event`);
            return router.handle(req, res, { 
                method: 'POST',
                url: '/create-event'
            });
        }
        
        // Prepare the event update data
        const eventBody = {
            summary: req.body.summary,
            location: req.body.location,
            description: req.body.description,
            start: { dateTime: convertAlchemyDate(req.body.StartUse, timeZone), timeZone },
            end: { dateTime: convertAlchemyDate(req.body.EndUse, timeZone), timeZone },
            reminders: req.body.reminders || { useDefault: true },
            // Ensure we maintain the Alchemy record ID
            extendedProperties: {
                private: {
                    alchemyRecordId: recordId
                }
            }
        };
        
        // Remove undefined fields
        Object.keys(eventBody).forEach(key => {
            if (eventBody[key] === undefined) {
                delete eventBody[key];
            }
        });
        
        // Send the PATCH request to update the existing event
        const response = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${existingEventId}`, 
            {
                method: "PATCH",
                headers: {
                    "Authorization": `Bearer ${accessToken}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(eventBody)
            }
        );
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(`Google Calendar Update Error: ${JSON.stringify(data)}`);
        }
        
        console.log(`✅ Event successfully updated in Google Calendar:`, data);
        
        res.status(200).json({ 
            success: true, 
            action: "updated",
            event: data 
        });
    } catch (error) {
        console.error(`❌ Error updating event: ${error.message}`);
        res.status(500).json({ 
            error: "Failed to update event", 
            details: error.message 
        });
    }
});

// 🆕 Route to Delete a Google Calendar Event
router.delete("/delete-event/:recordId", async (req, res) => {
    console.log(`📩 Request to delete event for Alchemy record: ${req.params.recordId}`);
    
    const recordId = req.params.recordId;
    const calendarId = req.query.calendarId || "primary";
    
    if (!recordId) {
        return res.status(400).json({ error: "Missing recordId parameter" });
    }
    
    const accessToken = await getGoogleAccessToken();
    if (!accessToken) {
        return res.status(500).json({ error: "Failed to obtain Google access token" });
    }
    
    try {
        // Find the existing event
        const existingEventId = await findExistingEvent(accessToken, calendarId, recordId);
        
        if (!existingEventId) {
            return res.status(404).json({ 
                success: false, 
                error: "Event not found", 
                message: `No Google Calendar event found for Alchemy record: ${recordId}` 
            });
        }
        
        // Delete the event
        const response = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${existingEventId}`,
            {
                method: "DELETE",
                headers: { "Authorization": `Bearer ${accessToken}` }
            }
        );
        
        // If successful delete, response will be empty with 204 status
        if (response.status === 204 || response.ok) {
            console.log(`✅ Event successfully deleted from Google Calendar: ${existingEventId}`);
            return res.status(200).json({ 
                success: true, 
                message: `Event successfully deleted for Alchemy record: ${recordId}` 
            });
        } else {
            const errorData = await response.json();
            throw new Error(`Google Calendar Delete Error: ${JSON.stringify(errorData)}`);
        }
    } catch (error) {
        console.error(`❌ Error deleting event: ${error.message}`);
        res.status(500).json({ 
            error: "Failed to delete event", 
            details: error.message 
        });
    }
});

export default router;
