const express = require("express");
const axios = require("axios");
const mongoose = require("mongoose");
require("dotenv").config();

const Clinic = require('./models/Clinic');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "test_token_app";

// --- DATABASE CONNECTION ---
mongoose.connect('mongodb://localhost:27017/whatsapp_clinics')
    .then(() => console.log('✅ Connected to MongoDB'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

// --- IN-MEMORY DATA STORE (BOT LOGIC) ---
// Note: Ideally, these should also be in the database per clinic.
const doctors = [
    { id: 'dr_general', name: 'Dr. Smith', specialization: 'General Physician', totalTokens: 12, currentToken: 5 },
    { id: 'dr_dentist', name: 'Dr. Jane', specialization: 'Dentist', totalTokens: 8, currentToken: 3 },
    { id: 'dr_cardio', name: 'Dr. Kumar', specialization: 'Cardiologist', totalTokens: 4, currentToken: 1 }
];

// User Sessions: { [phoneNumber]: { step: 'STRING', ... } }
const sessions = {};
// Appointments: Array of { id, userPhone, doctorId, patientName, tokenNumber, timestamp }
const appointments = [];

// --- HELPER FUNCTIONS ---

const sendMessage = async (to, data, clinic) => {
    if (!clinic || !clinic.phoneNumberId || !clinic.whatsappToken) {
        console.error("❌ Missing clinic credentials for sending message");
        return;
    }
    try {
        await axios.post(
            `https://graph.facebook.com/v18.0/${clinic.phoneNumberId}/messages`,
            {
                messaging_product: "whatsapp",
                to: to,
                ...data
            },
            {
                headers: {
                    Authorization: `Bearer ${clinic.whatsappToken}`,
                    "Content-Type": "application/json",
                },
            }
        );
    } catch (error) {
        console.error("Error sending message:", error.response ? error.response.data : error.message);
    }
};

const sendText = async (to, text, clinic) => {
    await sendMessage(to, { text: { body: text } }, clinic);
};

const sendButtons = async (to, text, buttons, clinic) => {
    const actionButtons = buttons.slice(0, 3).map(b => ({
        type: "reply",
        reply: { id: b.id, title: b.title.substring(0, 20) }
    }));

    await sendMessage(to, {
        type: "interactive",
        interactive: {
            type: "button",
            body: { text: text },
            action: { buttons: actionButtons }
        }
    }, clinic);
};

const sendList = async (to, text, title, options, clinic) => {
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
    }, clinic);
};

// --- CORE LOGIC ---

const handleIncomingMessage = async (from, message, clinic) => {
    const text = message.text?.body?.trim();
    const buttonId = message.interactive?.button_reply?.id;
    const listId = message.interactive?.list_reply?.id;

    const input = buttonId || listId || text || "";

    // Initialize session if not exists
    if (!sessions[from]) {
        sessions[from] = { step: 'START' };
    }
    const session = sessions[from];

    console.log(`Clinic: ${clinic.name}, User: ${from}, Input: ${input}, Step: ${session.step}`);

    // RESET or GREETING
    if (input.toLowerCase() === 'hi' || input.toLowerCase() === 'hello' || input === 'RESET') {
        sessions[from] = { step: 'START' };
        await sendButtons(from, `👋 Welcome to ${clinic.name}! How can we help you today?`, [
            { id: 'btn_book', title: 'Book Appointment' },
            { id: 'btn_status', title: 'Check Token Status' },
            { id: 'btn_avail', title: 'Check Availability' }
        ], clinic);
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
                await sendList(from, "Please select a doctor to book an appointment:", "Doctors List", docOptions, clinic);
            } else if (input === 'btn_status') {
                let statusMsg = "*Current Queue Status:*\n\n";
                doctors.forEach(d => {
                    statusMsg += `👨‍⚕️ *${d.name}* (${d.specialization})\n   🎟 Total Tokens: ${d.totalTokens}\n   ✅ Serving: ${d.currentToken}\n\n`;
                });
                await sendText(from, statusMsg, clinic);
                await sendButtons(from, "Would you like to do anything else?", [
                    { id: 'btn_book', title: 'Book Appointment' },
                    { id: 'RESET', title: 'Main Menu' }
                ], clinic);
            } else if (input === 'btn_avail') {
                session.step = 'SELECT_DOCTOR_AVAIL';
                let availMsg = "*Doctor Availability:*\n\n";
                doctors.forEach(d => {
                    const available = d.totalTokens < 20 ? "✅ Available Today" : "❌ Full Today";
                    availMsg += `👨‍⚕️ *${d.name}*: ${available}\n`;
                });
                await sendText(from, availMsg, clinic);
                await sendButtons(from, "What would you like to do next?", [
                    { id: 'btn_book', title: 'Book Now' },
                    { id: 'RESET', title: 'Main Menu' }
                ], clinic);
            } else {
                await sendText(from, "I didn't understand that. Please type 'Hi' to start over.", clinic);
            }
            break;

        case 'SELECT_DOCTOR_BOOK':
            const selectedDoc = doctors.find(d => d.id === input);
            if (selectedDoc) {
                session.selectedDoctorId = selectedDoc.id;
                session.step = 'ENTER_NAME';
                await sendText(from, `You have selected *${selectedDoc.name}*. \n\nPlease enter the *Patient Name* to confirm booking:`, clinic);
            } else {
                await sendText(from, "Invalid selection. Please select a doctor from the list.", clinic);
            }
            break;

        case 'ENTER_NAME':
            if (message.type === 'text') {
                const patientName = text;
                const doc = doctors.find(d => d.id === session.selectedDoctorId);

                // Confirm Booking
                doc.totalTokens += 1;
                const newToken = doc.totalTokens;

                const appointment = {
                    id: Date.now(),
                    userPhone: from,
                    doctorId: doc.id,
                    patientName: patientName,
                    tokenNumber: newToken,
                    timestamp: new Date(),
                    clinicId: clinic._id // Track which clinic
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

                await sendText(from, successMsg, clinic);

                await sendButtons(from, "Back to Main Menu?", [
                    { id: 'RESET', title: 'Main Menu' }
                ], clinic);

            } else {
                await sendText(from, "Please enter a valid text name.", clinic);
            }
            break;

        default:
            await sendButtons(from, "Something went wrong. Return to menu?", [
                { id: 'RESET', title: 'Main Menu' }
            ], clinic);
            sessions[from] = { step: 'START' };
            break;
    }
};

// --- API ROUTES ---

// API 1: Enquire / Step 1
app.post("/api/clinic/enquire", (req, res) => {
    const { name, businessPhoneNumber, logoUrl } = req.body;
    if (!name || !businessPhoneNumber) {
        return res.status(400).json({ error: "Name and Business Phone Number are required" });
    }
    // Logic to "query details" or prepare for next step
    // For now, we just acknowledge. 
    console.log("Clinic Enquiry:", req.body);
    res.json({
        message: "Clinic details received. Please proceed to registration.",
        data: { name, businessPhoneNumber, logoUrl }
    });
});

// API 2: Register / Store Details
app.post("/api/clinic/register", async (req, res) => {
    try {
        const { name, businessPhoneNumber, logoUrl, phoneNumberId, whatsappToken } = req.body;

        if (!businessPhoneNumber || !phoneNumberId || !whatsappToken) {
            return res.status(400).json({ error: "Missing required fields" });
        }

        // Upsert clinic details
        const clinic = await Clinic.findOneAndUpdate(
            { businessPhoneNumber },
            { name, logoUrl, phoneNumberId, whatsappToken },
            { new: true, upsert: true }
        );

        res.json({ message: "Clinic successfully registered", clinic });
    } catch (error) {
        console.error("Registration Error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});


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

        if (body.object) {

            // Check if entry exists and has changes
            if (body.entry && body.entry[0].changes && body.entry[0].changes[0].value) {
                const value = body.entry[0].changes[0].value;
                const metadata = value.metadata;

                if (metadata && metadata.phone_number_id) {
                    const phoneNumberId = metadata.phone_number_id;

                    // 1. Find the clinic by phone_number_id
                    const clinic = await Clinic.findOne({ phoneNumberId });

                    if (clinic) {
                        if (value.messages && value.messages[0]) {
                            const message = value.messages[0];
                            const from = message.from;

                            // 2. Handle message with the found clinic context
                            await handleIncomingMessage(from, message, clinic);
                        }
                    } else {
                        console.warn(`⚠️ Received webhook for unknown Phone Number ID: ${phoneNumberId}`);
                    }
                }
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