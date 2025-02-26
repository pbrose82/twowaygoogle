import express from "express";
import fetch from "node-fetch";
import { DateTime } from "luxon";
import dotenv from "dotenv";

dotenv.config();
const router = express.Router();

const ALCHEMY_REFRESH_URL = "https://core-production.alchemy.cloud/core/api/v2/refresh-token";
const ALCHEMY_UPDATE_URL = "https://core-production.alchemy.cloud/core/api/v2/update-record";
const TENANT_NAME = "productcaseelnlims4uat";

// ✅ Function to Convert Date to Alchemy Format (UTC)
function convertToAlchemyFormat(dateString) {
    try {
        let date = DateTime.fromISO(dateString, { zone: "UTC" });

        if (!date.isValid) {
            throw new Error(`Invalid date format received: ${dateString}`);
        }

        return date.toUTC().toFormat("yyyy-MM-dd'T'HH:mm:ss'Z'");
    } catch (error) {
        console.error("❌ Date conversion error:", error.message);
        return null;
    }
}

// ✅ Function to Refresh Alchemy Token
async function refreshAlchemyToken() {
    console.log("🔄 Refreshing Alchemy Token...");

    const response = await fetch(ALCHEMY_REFRESH_URL, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: process.env.ALCHEMY_REFRESH_TOKEN })
    });

    const data = await response.json();
    if (!response.ok) {
        throw new Error(`Alchemy Token Refresh Failed: ${JSON.stringify(data)}`);
    }

    const tenantToken = data.tokens.find(token => token.tenant === TENANT_NAME);
    if (!tenantToken) {
        throw new Error(`Tenant '${TENANT_NAME}' not found.`);
    }

    console.log("✅ Alchemy Token Refreshed Successfully");
    return tenantToken.accessToken;
}

// ✅ Route to Update Alchemy Record
router.put("/update-alchemy", async (req, res) => {
    console.log("📩 Google Calendar update received:", JSON.stringify(req.body, null, 2));

    const alchemyToken = await refreshAlchemyToken();
    if (!alchemyToken) {
        return res.status(500).json({ error: "Failed to refresh Alchemy token" });
    }

    const alchemyPayload = {
        recordId: req.body.id,
        fields: [
            { identifier: "StartUse", rows: [{ row: 0, values: [{ value: convertToAlchemyFormat(req.body.start.dateTime) }] }] },
            { identifier: "EndUse", rows: [{ row: 0, values: [{ value: convertToAlchemyFormat(req.body.end.dateTime) }] }] }
        ]
    };

    const response = await fetch(ALCHEMY_UPDATE_URL, {
        method: "PUT",
        headers: {
            "Authorization": `Bearer ${alchemyToken}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(alchemyPayload)
    });

    const data = await response.json();
    if (!response.ok) {
        throw new Error(`Alchemy API Error: ${JSON.stringify(data)}`);
    }

    console.log("✅ Alchemy record updated:", data);
    res.status(200).json({ success: true, message: "Alchemy record updated", data });
});

export default router;
