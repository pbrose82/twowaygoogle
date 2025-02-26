import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

async function watchGoogleCalendar() {
    try {
        console.log("🔔 Registering Google Calendar Webhook...");

        const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${process.env.GOOGLE_CALENDAR_ID}/events/watch`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.GOOGLE_ACCESS_TOKEN}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                id: "unique-channel-id-1234",  // This must be unique for every registration
                type: "web_hook",
                address: process.env.WEBHOOK_URL,  // This is where Google will send event updates
                params: { ttl: "86400" }  // The webhook will expire in 24 hours
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(`Webhook Registration Failed: ${JSON.stringify(data)}`);
        }

        console.log("✅ Google Webhook Registered Successfully!", data);
    } catch (error) {
        console.error("❌ Error setting up Google webhook:", error.message);
    }
}

watchGoogleCalendar();
