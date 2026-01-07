const express = require("express");
const axios = require("axios")
require("dotenv").config();
const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = "test_token_app";

/**
 * ✅ GET — Webhook verification
 */
app.get("/webhook", (req, res) => {
    console.log("🔍 Verification request received");
    console.log(req.query);

    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
        console.log("✅ WEBHOOK VERIFIED");
        return res.status(200).send(challenge);
    }

    console.log("❌ Verification failed");
    res.sendStatus(403);
});


const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.PHONE_NUMBER_ID;

app.post("/webhook", async (req, res) => {
    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    console.log(req?.body?.entry?.[0]?.changes[0]?.value?.contacts, "entry")
    console.log(req?.body?.entry?.[0]?.changes[0]?.value?.metadata, "entry")
    console.log(req?.body?.entry?.[0]?.changes[0]?.value?.messages, "entry")

    if (message) {
        const from = message.from;
        const text = message.text?.body;
        console.log(from, text, "from")

        if (text == "HI") {
            await axios.post(
                `https://graph.facebook.com/v18.0/${PHONE_ID}/messages`,
                { "messaging_product": "whatsapp", "to": from, "type": "interactive", "interactive": { "type": "button", "body": { "text": "👋 Welcome to ABC Clinic\nPlease choose an option:" }, "action": { "buttons": [{ "type": "reply", "reply": { "id": "book_appointment", "title": "📅 Book Appointment" } }, { "type": "reply", "reply": { "id": "consult_doctor", "title": "👨‍⚕️ Consult Doctor" } }, { "type": "reply", "reply": { "id": "contact_clinic", "title": "☎️ Contact Clinic" } }] } } },
                {
                    headers: {
                        Authorization: `Bearer ${TOKEN}`,
                        "Content-Type": "application/json",
                    },
                }
            );
        } else {
            await axios.post(
                `https://graph.facebook.com/v18.0/${PHONE_ID}/messages`,
                {
                    messaging_product: "whatsapp",
                    to: from,
                    text: { body: `You said: ${text}` },
                },
                {
                    headers: {
                        Authorization: `Bearer ${TOKEN}`,
                        "Content-Type": "application/json",
                    },
                }
            );
        }

    }

    res.sendStatus(200);
});


/**
 * Start server
 */
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});