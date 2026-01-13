const express = require("express");
const axios = require("axios");
require("dotenv").config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = "test_token_app"; // Move to env in prod
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.PHONE_NUMBER_ID;

// --- IN-MEMORY DATA STORE ---
const doctors = [
    { id: 'dr_general', name: 'Dr. Smith', specialization: 'General Physician', totalTokens: 12, currentToken: 5 },
    { id: 'dr_dentist', name: 'Dr. Jane', specialization: 'Dentist', totalTokens: 8, currentToken: 3 },
    { id: 'dr_cardio', name: 'Dr. Kumar', specialization: 'Cardiologist', totalTokens: 4, currentToken: 1 }
];

// User Sessions: { [phoneNumber]: { step: 'STRING', checkAvailability?: boolean, selectedDoctorId?: string } }
const sessions = {};

// Appointments: Array of { id, userPhone, doctorId, patientName, tokenNumber, timestamp }
const appointments = [];

// --- HELPER FUNCTIONS ---

const sendMessage = async (to, data) => {
    try {
        await axios.post(
            `https://graph.facebook.com/v18.0/${PHONE_ID}/messages`,
            {
                messaging_product: "whatsapp",
                to: to,
                ...data
            },
            {
                headers: {
                    Authorization: `Bearer ${WHATSAPP_TOKEN}`,
                    "Content-Type": "application/json",
                },
            }
        );
    } catch (error) {
        console.error("Error sending message:", error.response ? error.response.data : error.message);
    }
};

const sendText = async (to, text) => {
    await sendMessage(to, { text: { body: text } });
};

const sendButtons = async (to, text, buttons) => {
    // buttons: [{ id: 'id1', title: 'Title' }]
    const actionButtons = buttons.slice(0, 3).map(b => ({
        type: "reply",
        reply: { id: b.id, title: b.title.substring(0, 20) } // Title max 20 chars
    }));

    await sendMessage(to, {
        type: "interactive",
        interactive: {
            type: "button",
            body: { text: text },
            action: { buttons: actionButtons }
        }
    });
};

const sendList = async (to, text, title, options) => {
    // options: [{ id: 'id1', title: 'Main', description: 'Sub' }]
    const rows = options.map(opt => ({
        id: opt.id,
        title: opt.title.substring(0, 24),
        description: opt.description ? opt.description.substring(0, 72) : ""
    }));

    await sendMessage(to, {
        type: "interactive",
        interactive: {
            type: "list",
            header: { type: "text", text: title },
            body: { text: text },
            footer: { text: "Select an option" },
            action: {
                button: "View Options",
                sections: [
                    {
                        title: "Available Options",
                        rows: rows
                    }
                ]
            }
        }
    });
};

// --- CORE LOGIC ---

const handleIncomingMessage = async (from, message) => {
    const text = message.text?.body?.trim();
    const buttonId = message.interactive?.button_reply?.id;
    const listId = message.interactive?.list_reply?.id;

    const input = buttonId || listId || text || "";

    // Initialize session if not exists
    if (!sessions[from]) {
        sessions[from] = { step: 'START' };
    }
    const session = sessions[from];

    console.log(`User: ${from}, Input: ${input}, Step: ${session.step}`);

    // RESET or GREETING
    if (input.toLowerCase() === 'hi' || input.toLowerCase() === 'hello' || input === 'RESET') {
        sessions[from] = { step: 'START' };
        await sendButtons(from, "👋 Welcome to ABC Clinic! How can we help you today?", [
            { id: 'btn_book', title: 'Book Appointment' },
            { id: 'btn_status', title: 'Check Token Status' },
            { id: 'btn_avail', title: 'Check Availability' }
        ]);
        return;
    }

    switch (session.step) {
        case 'START':
            if (input === 'btn_book') {
                session.step = 'SELECT_DOCTOR_BOOK';
                const docOptions = doctors.map(d => ({
                    id: d.id,
                    title: d.name,
                    description: d.specialization
                }));
                await sendList(from, "Please select a doctor to book an appointment:", "Doctors List", docOptions);
            } else if (input === 'btn_status') {
                let statusMsg = "*Current Queue Status:*\n\n";
                doctors.forEach(d => {
                    statusMsg += `👨‍⚕️ *${d.name}* (${d.specialization})\n   🎟 Total Tokens: ${d.totalTokens}\n   ✅ Serving: ${d.currentToken}\n\n`;
                });
                await sendText(from, statusMsg);
                // Reset to start options
                await sendButtons(from, "Would you like to do anything else?", [
                    { id: 'btn_book', title: 'Book Appointment' },
                    { id: 'RESET', title: 'Main Menu' }
                ]);
            } else if (input === 'btn_avail') {
                session.step = 'SELECT_DOCTOR_AVAIL'; // Just strictly for availability check or we can just show all
                let availMsg = "*Doctor Availability:*\n\n";
                doctors.forEach(d => {
                    // Mock availability logic
                    const available = d.totalTokens < 20 ? "✅ Available Today" : "❌ Full Today";
                    availMsg += `👨‍⚕️ *${d.name}*: ${available}\n`;
                });
                await sendText(from, availMsg);
                await sendButtons(from, "What would you like to do next?", [
                    { id: 'btn_book', title: 'Book Now' },
                    { id: 'RESET', title: 'Main Menu' }
                ]);
            } else {
                await sendText(from, "I didn't understand that. Please type 'Hi' to start over.");
            }
            break;

        case 'SELECT_DOCTOR_BOOK':
            const selectedDoc = doctors.find(d => d.id === input);
            if (selectedDoc) {
                session.selectedDoctorId = selectedDoc.id;
                session.step = 'ENTER_NAME';
                await sendText(from, `You have selected *${selectedDoc.name}*. \n\nPlease enter the *Patient Name* to confirm booking:`);
            } else {
                await sendText(from, "Invalid selection. Please select a doctor from the list.");
            }
            break;

        case 'ENTER_NAME':
            if (message.type === 'text') { // Ensure it's text
                const patientName = text;
                const doc = doctors.find(d => d.id === session.selectedDoctorId);

                // Confirm Booking
                doc.totalTokens += 1; // Increment token count for the day
                const newToken = doc.totalTokens;

                const appointment = {
                    id: Date.now(),
                    userPhone: from,
                    doctorId: doc.id,
                    patientName: patientName,
                    tokenNumber: newToken,
                    timestamp: new Date()
                };
                appointments.push(appointment);

                // Reset session
                sessions[from] = { step: 'START' };

                const successMsg = `✅ *Booking Confirmed!*\n\n` +
                    `👤 Patient: *${patientName}*\n` +
                    `👨‍⚕️ Doctor: *${doc.name}*\n` +
                    `🎟 *Your Token Number: ${newToken}*\n` +
                    `👀 Current Serving Token: ${doc.currentToken}\n\n` +
                    `Please arrive 15 minutes before your estimated time.`;

                await sendText(from, successMsg);

                // Follow up
                await sendButtons(from, "Back to Main Menu?", [
                    { id: 'RESET', title: 'Main Menu' }
                ]);

            } else {
                await sendText(from, "Please enter a valid text name.");
            }
            break;

        default:
            // Fallback
            await sendButtons(from, "Something went wrong. Return to menu?", [
                { id: 'RESET', title: 'Main Menu' }
            ]);
            sessions[from] = { step: 'START' };
            break;
    }
};

// --- WEBHOOK ROUTES ---

app.get("/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
        console.log("✅ WEBHOOK VERIFIED");
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

app.post("/webhook", async (req, res) => {
    try {
        const body = req.body;
        // console.log(JSON.stringify(body, null, 2)); // Debug log

        if (body.object) {
            if (
                body.entry &&
                body.entry[0].changes &&
                body.entry[0].changes[0].value.messages &&
                body.entry[0].changes[0].value.messages[0]
            ) {
                const message = body.entry[0].changes[0].value.messages[0];
                const from = message.from;

                // Avoid handling status updates or other message types if needed
                // Currently assume all messages in this path are user interactions
                await handleIncomingMessage(from, message);
            }
            res.sendStatus(200);
        } else {
            res.sendStatus(404);
        }
    } catch (error) {
        console.error("Error in webhook handler:", error);
        res.sendStatus(500);
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});